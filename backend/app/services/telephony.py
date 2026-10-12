import asyncio
import base64
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
import websockets
from fastapi import WebSocket
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app.db import SessionLocal
from app.models import Call, Lead, Message
from app.services import stt, tts
from app.services.agent import CallAgent
from app.services.call_profile import opening_statement, stage_and_load_caller_profile
from app.services.caller_lookup import NO_CRM_MATCH, performSynchronousCallerLookup
from app.services.events import (
    emit_agent_speaking_state,
    emit_call_status,
    emit_profile_enriched,
    emit_sentiment,
    emit_transcription,
)
from app.services.tts_persona import select_speaking_state
from app.services.sentiment import score_utterance
from app.services.summarizer import summarize_call

logger = logging.getLogger("voice_agent")

CHUNK_MS = 20
SAMPLE_RATE = 8000
# 40ms of 8 kHz 16-bit PCM. Playback follows a monotonic 40ms deadline.
PACKET_BYTES = 640
PACKET_INTERVAL_S = 0.040
TURN_SILENCE_MS = 100  # join split finals; Deepgram endpointing already waits 300ms
BARGE_IN_MIN_CHARS = 5  # only barge-in on real speech, not VAD noise


@dataclass
class _QueuedUtterance:
    """Audio task plus the turn's persona, chosen before synthesis started."""

    task: asyncio.Task[tuple[bytes, str]]
    step: str
    voice_profile: str
    intent: str | None = None
    turn: int = 0


def audio_chunk_size(codec: str) -> int:
    """Bytes for CHUNK_MS of 8 kHz mono audio. linear16 is 2 bytes per sample."""
    bytes_per_sample = 2 if codec == "linear16" else 1
    return SAMPLE_RATE * bytes_per_sample * CHUNK_MS // 1000


class CallSession:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.db: Session = SessionLocal()
        self.call_id: int | None = None
        self.call_sid: str | None = None
        self.stream_sid: str | None = None
        # Outbound frames must echo the provider's own key: streamSid or stream_sid.
        self.stream_id_key: str = "streamSid"
        self.is_exotel = False
        self.audio_codec = "mulaw"
        self.audio_chunk_size = audio_chunk_size(self.audio_codec)
        self.dg = None
        self.agent: CallAgent | None = None
        self.utterance_queue: asyncio.Queue[_QueuedUtterance] = asyncio.Queue()
        self._inflight_tts: asyncio.Task[tuple[bytes, str]] | None = None
        self.finals_queue: asyncio.Queue[str] = asyncio.Queue()
        self.barge_in = asyncio.Event()
        self.speaking = False
        self.discard_reply = False
        self.greeting_played = False
        self.transcript: list[tuple[str, str]] = []
        self._turn_buffer: list[str] = []
        self._flush_task: asyncio.Task | None = None
        self.http_client: httpx.AsyncClient | None = None

    async def run(self) -> None:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(60.0),
            limits=httpx.Limits(max_keepalive_connections=8, max_connections=16),
        ) as http_client:
            self.http_client = http_client
            try:
                await self._run_session()
            finally:
                await self._write_summary()
        self.http_client = None

    async def _run_session(self) -> None:
        await self._wait_for_start()
        if not self.stream_sid:
            logger.warning("No stream id; aborting")
            return

        # Start TTS immediately so the greeting synthesizes while we connect to Deepgram
        tts_task = asyncio.create_task(self._tts_worker())

        logger.info("Connecting to Deepgram STT…")
        try:
            self.dg = await websockets.connect(
                stt.build_listen_url(self.audio_codec),
                additional_headers=stt.auth_headers(),
                max_size=None,
                max_queue=512,
                ping_interval=None,
            )
        except Exception as exc:
            logger.exception("Deepgram STT connect failed: %s", exc)
            tts_task.cancel()
            return
        logger.info("Deepgram STT connected")

        tasks = {
            "twilio": asyncio.create_task(self._twilio_loop()),
            "deepgram": asyncio.create_task(self._deepgram_loop()),
            "keepalive": asyncio.create_task(self._keepalive_loop()),
            "agent": asyncio.create_task(self._agent_loop()),
            "tts": tts_task,
        }
        try:
            await tasks["twilio"]
        finally:
            for name, task in tasks.items():
                if name != "twilio":
                    task.cancel()
            await asyncio.gather(
                *(t for n, t in tasks.items() if n != "twilio"),
                return_exceptions=True,
            )
        logger.info("Call loop ended")

    async def _wait_for_start(self) -> None:
        while True:
            raw = await self.ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Ignoring non-JSON media-stream frame")
                continue
            event = data.get("event")
            # Exotel sends `connected` before `start`. Twilio does not.
            if event == "connected":
                logger.info("Provider connected: %s", data.get("protocol") or "media stream")
                continue
            if event == "start":
                await self._on_start(data)
                return

    def _capture_stream_identity(self, message: dict) -> None:
        """Read Twilio camelCase or Exotel snake_case stream identity from `start`."""
        start = message.get("start") or {}
        self.stream_id_key = "stream_sid" if "stream_sid" in start else "streamSid"
        self.stream_sid = start.get("streamSid") or start.get("stream_sid")
        self.call_sid = start.get("callSid") or start.get("call_sid") or "unknown"
        self.is_exotel = "stream_sid" in start
        self.audio_codec = "linear16" if self.is_exotel else "mulaw"
        self.audio_chunk_size = audio_chunk_size(self.audio_codec)

    async def _on_start(self, data: dict) -> None:
        start = data.get("start") or {}
        self._capture_stream_identity(data)
        custom = start.get("customParameters") or start.get("custom_parameters") or {}
        from_number = custom.get("from") or start.get("from")
        to_number = custom.get("to") or start.get("to")
        call = Call(
            call_sid=self.call_sid,
            from_number=from_number or None,
            to_number=to_number or None,
            status="in-progress",
        )
        self.db.add(call)
        self.db.commit()
        self.call_id = call.id
        self.agent = CallAgent(self.db, self.call_id, caller_number=from_number)
        # ANI lookup, then Redis, then the first spoken line. Nothing is queued before this.
        lookup = (
            performSynchronousCallerLookup(str(from_number)) if from_number else None
        )
        looked_up = lookup.data if lookup and lookup.matched else None
        profile = stage_and_load_caller_profile(self.call_sid or "unknown", looked_up)
        self.agent.set_caller_profile(profile)
        if self.call_sid:
            if profile:
                emit_profile_enriched(
                    self.call_sid, profile, lookup.source if lookup else NO_CRM_MATCH
                )
            else:
                emit_profile_enriched(
                    self.call_sid,
                    {"ownership_type": "UNKNOWN"},
                    NO_CRM_MATCH,
                )
        greeting = opening_statement(profile)
        self._enqueue_speech(greeting, opening=True)
        emit_call_status(self.call_sid, "active")
        emit_transcription(self.call_sid, greeting, "agent")
        logger.info(
            "Call started: provider_key=%s codec=%s call_sid=%s stream_sid=%s from=%s",
            self.stream_id_key,
            self.audio_codec,
            self.call_sid,
            self.stream_sid,
            from_number,
        )

    async def _twilio_loop(self) -> None:
        media_chunks = 0
        try:
            async for raw in self.ws.iter_text():
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("Ignoring non-JSON media-stream frame")
                    continue
                event = data.get("event")
                if event == "media":
                    media = data.get("media") or {}
                    # Twilio tags caller audio with track=inbound. Exotel omits track
                    # and uses the same media.payload base64 buffer.
                    track = media.get("track")
                    if track not in (None, "inbound"):
                        continue
                    encoded = media.get("payload")
                    if not encoded:
                        continue
                    payload = base64.b64decode(encoded)
                    await self.dg.send(payload)
                    media_chunks += 1
                    if media_chunks == 1:
                        logger.info("First inbound media chunk received (%d bytes)", len(payload))
                elif event == "stop":
                    logger.info("Provider sent 'stop'")
                    break
        except WebSocketDisconnect:
            logger.info("Media stream WebSocket disconnected")
        except Exception as exc:
            logger.exception("twilio_loop error: %s", exc)
        logger.info("twilio_loop ended after %d media chunks", media_chunks)

    async def _deepgram_loop(self) -> None:
        try:
            async for raw in self.dg:
                if isinstance(raw, bytes):
                    continue
                data = json.loads(raw)
                mtype = data.get("type")
                if mtype == "SpeechStarted":
                    logger.info("SpeechStarted (speaking=%s)", self.speaking)
                elif mtype == "Results":
                    transcript, is_final = stt.parse_result(data)
                    text = transcript.strip()
                    if not text:
                        continue
                    if is_final:
                        logger.info("Final transcript: %s", text)
                        if self.speaking:
                            self._interrupt_speech()
                            logger.info("Barge-in (final)")
                        self._turn_buffer.append(text)
                        self._schedule_flush()
                    elif self.speaking and len(text) >= BARGE_IN_MIN_CHARS:
                        self._interrupt_speech()
                        logger.info("Barge-in (interim): %s", text)
                elif mtype == "UtteranceEnd":
                    logger.info("UtteranceEnd")
                    self._cancel_flush()
                    self._flush_turn()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("deepgram_loop error: %s", exc)

    def _schedule_flush(self) -> None:
        """(Re)arm a timer that flushes the buffered turn after a silence gap."""
        self._cancel_flush()
        self._flush_task = asyncio.create_task(self._delayed_flush())

    def _cancel_flush(self) -> None:
        if self._flush_task is not None:
            self._flush_task.cancel()
            self._flush_task = None

    async def _delayed_flush(self) -> None:
        await asyncio.sleep(TURN_SILENCE_MS / 1000)
        self._flush_turn()

    def _flush_turn(self) -> None:
        if not self._turn_buffer:
            return
        text = " ".join(self._turn_buffer).strip()
        self._turn_buffer.clear()
        if text:
            self.finals_queue.put_nowait(text)

    async def _keepalive_loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(10)
                await self.dg.send(json.dumps({"type": "KeepAlive"}))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("keepalive_loop error: %s", exc)

    def _interrupt_speech(self) -> None:
        """Stop the current reply and drop clauses that have not started playing."""
        self.barge_in.set()
        self.discard_reply = True
        if self.agent is not None:
            # The next turn must acknowledge the caller's new question first.
            self.agent.note_barge_in()
        if self._inflight_tts is not None and not self._inflight_tts.done():
            self._inflight_tts.cancel()
        while True:
            try:
                pending = self.utterance_queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            pending.task.cancel()

    async def _agent_loop(self) -> None:
        while True:
            text = await self.finals_queue.get()
            self.discard_reply = False
            logger.info("Agent processing turn: %s", text[:80])
            try:
                self.transcript.append(("customer", text))
                self._save_message("customer", text)
                emit_transcription(self.call_sid or "unknown", text, "user")
                emit_sentiment(self.call_sid or "unknown", score_utterance(text))
                spoken: list[str] = []
                # Intent, required tool, and persona are settled before any audio.
                await self.agent.prepare_turn(text)
                self._publish_turn_state()
                async for sentence in self.agent.respond(
                    text, self.http_client, prepared=True
                ):
                    spoken.append(sentence)
                    if self.discard_reply:
                        continue
                    self._enqueue_speech(sentence)
                reply = " ".join(spoken).strip()
                if reply:
                    self.transcript.append(("assistant", reply))
                    self._save_message("assistant", reply)
                    emit_transcription(self.call_sid or "unknown", reply, "agent")
                if self.agent.handed_off:
                    self._set_handed_off()
                logger.info("Agent reply: %s", reply[:80])
            except Exception as exc:
                logger.exception("agent_loop error: %s", exc)
                if not self.discard_reply:
                    self._enqueue_speech(
                        "I'm sorry, I'm having a little trouble. Please hold while I connect you to our team."
                    )

    def _caller_identified(self) -> bool:
        agent = self.agent
        if agent is None:
            return False
        profile = agent.caller_profile or {}
        if str(profile.get("name") or "").strip():
            return True
        name = str(agent.call_state.get("name") or "").strip()
        return bool(name) and name.lower() != "unknown"

    def _enqueue_speech(self, text: str, *, opening: bool = False) -> None:
        """Pick the persona, then start synthesis before this line is played.

        `opening` is the canned first line. Later lines use the intent the
        dialogue manager already set on this turn.
        """
        intent = None if opening or self.agent is None else self.agent.active_intent
        step, persona = select_speaking_state(
            intent, identified=self._caller_identified(), opening=opening
        )
        logger.info(
            "Speaking [%s | %s | speed %s volume %s emotion %s]: %s",
            step,
            persona.label,
            persona.speed,
            persona.volume,
            persona.emotion,
            text[:80],
        )
        turn = 0 if self.agent is None else self.agent.turn
        # Synthesis starts now with this turn's speed, volume, and emotion.
        task = asyncio.create_task(
            tts.synthesize(
                text,
                encoding=self.audio_codec,
                http_client=self.http_client,
                persona=persona,
            )
        )
        self.utterance_queue.put_nowait(
            _QueuedUtterance(
                task=task,
                step=step,
                voice_profile=persona.label,
                intent=intent,
                turn=turn,
            )
        )

    async def _tts_worker(self) -> None:
        while True:
            queued = await self.utterance_queue.get()
            task = queued.task
            self._inflight_tts = task
            try:
                if self.discard_reply:
                    task.cancel()
                    continue
                self.barge_in.clear()
                try:
                    audio, voice_used = await task
                except asyncio.CancelledError:
                    if self.discard_reply and not asyncio.current_task().cancelling():
                        continue
                    raise
                if self.discard_reply or self.barge_in.is_set():
                    continue
                logger.info("TTS returned %d bytes (%s)", len(audio), voice_used)
                # The HUD shows the voice the caller is about to hear, not the queued one.
                self._publish_speaking_state(
                    queued.step, voice_used, queued.intent, queued.turn
                )
                await self._stream_audio(audio, allow_barge_in=self.greeting_played)
                self.greeting_played = True
            except asyncio.CancelledError:
                task.cancel()
                raise
            except Exception as exc:
                logger.exception("tts_worker error: %s", exc)
            finally:
                if self._inflight_tts is task:
                    self._inflight_tts = None

    def _publish_speaking_state(
        self,
        step: str,
        voice_profile: str,
        intent: str | None = None,
        turn: int | None = None,
    ) -> None:
        if turn is None:
            turn = None if self.agent is None else self.agent.turn
        emit_agent_speaking_state(
            self.call_sid or "unknown", step, voice_profile, turn=turn, intent=intent
        )

    def _publish_turn_state(self) -> None:
        """One state event per turn, sent once the intent and tool are known."""
        if self.agent is None:
            return
        intent = self.agent.active_intent
        step, persona = select_speaking_state(
            intent, identified=self._caller_identified()
        )
        logger.info(
            "Turn %d state: step=%s voice=%s intent=%s",
            self.agent.turn,
            step,
            persona.label,
            intent,
        )
        self._publish_speaking_state(step, persona.label, intent)

    def _paced_packets(self, audio: bytes) -> list[bytes]:
        """Exact 640-byte frames. The final short tail is padded, never sent whole."""
        if self.audio_codec == "linear16" and len(audio) % 2:
            audio = audio[:-1]
        if not audio:
            return []
        pad = b"\x00" if self.audio_codec == "linear16" else b"\xff"
        packets: list[bytes] = []
        for offset in range(0, len(audio), PACKET_BYTES):
            chunk = audio[offset : offset + PACKET_BYTES]
            if len(chunk) < PACKET_BYTES:
                chunk += pad * (PACKET_BYTES - len(chunk))
            packets.append(chunk)
        return packets

    async def _stream_audio(self, audio: bytes, allow_barge_in: bool = True) -> None:
        packets_sent = 0
        self.speaking = True
        try:
            start_time = time.perf_counter()
            for idx, packet in enumerate(self._paced_packets(audio), start=1):
                if allow_barge_in and self.barge_in.is_set():
                    logger.info("Barge-in: clearing audio")
                    await self._send_clear()
                    return
                await self.ws.send_text(
                    self._outbound_event(
                        "media",
                        media={"payload": base64.b64encode(packet).decode()},
                    )
                )
                packets_sent += 1
                target = start_time + (idx * PACKET_INTERVAL_S)
                delay = target - time.perf_counter()
                if delay > 0:
                    await asyncio.sleep(delay)
        finally:
            self.speaking = False
        logger.info("Streamed %d audio packets", packets_sent)

    def _outbound_event(self, event: str, **fields: object) -> str:
        """Build a provider frame. Exotel expects stream_sid; Twilio expects streamSid."""
        body: dict[str, object] = {"event": event, self.stream_id_key: self.stream_sid}
        body.update(fields)
        return json.dumps(body)

    async def _send_clear(self) -> None:
        try:
            await self.ws.send_text(self._outbound_event("clear"))
        except Exception as exc:
            logger.warning("clear failed: %s", exc)

    def _save_message(self, role: str, content: str) -> None:
        self.db.add(Message(call_id=self.call_id, role=role, content=content))
        self.db.commit()

    def _set_handed_off(self) -> None:
        call = self.db.get(Call, self.call_id)
        if call:
            call.handed_off = True
            self.db.commit()

    async def _write_summary(self) -> None:
        if self.call_id is None or not self.transcript:
            return
        call = self.db.get(Call, self.call_id)
        if call is None or call.summary:
            return
        transcript_text = "\n".join(
            f"{role.capitalize()}: {content}" for role, content in self.transcript
        )
        try:
            summary = await summarize_call(transcript_text, self.http_client)
            call.intent = summary.get("intent")
            call.summary = summary.get("summary")
            call.next_action = summary.get("next_action")
            self.db.commit()
            logger.info("Summary generated: intent=%s", summary.get("intent"))
        except Exception as exc:
            logger.exception("summarize_call failed: %s", exc)

    async def teardown(self) -> None:
        try:
            if self.dg is not None:
                await self.dg.close()
        except Exception as exc:
            logger.warning("dg close failed: %s", exc)

        if self.call_id is not None:
            call = self.db.get(Call, self.call_id)
            if call:
                call.status = "completed"
                call.ended_at = datetime.now(timezone.utc)
                lead = (
                    self.db.query(Lead)
                    .filter(Lead.call_id == self.call_id)
                    .order_by(Lead.id.desc())
                    .first()
                )
                if lead and lead.score:
                    call.lead_score = lead.score
                if self.transcript and not call.summary:
                    await self._write_summary()
                self.db.commit()
                if self.call_sid:
                    emit_call_status(self.call_sid, "completed")

        self.db.close()
        logger.info("Teardown complete")
