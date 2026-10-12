"""Fire-and-forget publisher for the `voice_agent_events` Redis channel.

`emit()` only schedules work. The speech loop never awaits a publish, so a
slow or absent Redis cannot stall STT, the LLM, or audio pacing.
"""

import asyncio
import json
import logging
import time

from redis.asyncio import Redis

from app.config import get_settings

logger = logging.getLogger("voice_agent.events")

_client: Redis | None = None
_connect_lock = asyncio.Lock()
_retry_after = 0.0
_down_logged = False


def emit_transcription(call_sid: str, text: str, source: str) -> None:
    emit(
        {
            "CallSID": call_sid,
            "type": "transcription",
            "text": text,
            "source": source,
        }
    )


def emit_sentiment(call_sid: str, score: int) -> None:
    emit({"CallSID": call_sid, "type": "sentiment", "score": score})


def emit_call_status(call_sid: str, status: str) -> None:
    emit({"CallSID": call_sid, "type": "call_status", "status": status})


def emit_profile_enriched(call_sid: str, profile: dict, source: str) -> None:
    emit(
        {
            "CallSID": call_sid,
            "type": "profile_enriched",
            "source": source,
            "profile": profile,
        }
    )


def emit_agent_speaking_state(
    call_sid: str,
    current_step: str,
    voice_profile_used: str,
    turn: int | None = None,
    intent: str | None = None,
) -> None:
    """Publish the step and voice for this turn. `turn` and `intent` are additive."""
    payload = {
        "CallSID": call_sid,
        "type": "agent_speaking_state",
        "current_step": current_step,
        "voice_profile_used": voice_profile_used,
    }
    if turn is not None:
        payload["turn"] = turn
    if intent is not None:
        payload["intent"] = intent
    emit(payload)


def emit_rsa_confirmed(call_sid: str, gps: str, caller_number: str) -> None:
    emit(
        {
            "CallSID": call_sid,
            "type": "rsa_confirmed",
            "gps": gps,
            "caller_number": caller_number,
        }
    )


def emit(payload: dict) -> None:
    """Schedule a publish. Safe to call from the voice loop; never awaits."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("Dropped voice event: no running event loop")
        return
    task = loop.create_task(_publish(payload), name="redis-publish")
    task.add_done_callback(_log_task_error)


def _log_task_error(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.warning("Redis publish task failed: %s", exc)


async def _client_or_none() -> Redis | None:
    global _client, _retry_after, _down_logged
    if _client is not None:
        return _client
    if time.monotonic() < _retry_after:
        return None

    async with _connect_lock:
        if _client is not None:
            return _client
        if time.monotonic() < _retry_after:
            return None
        settings = get_settings()
        client = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )
        try:
            await asyncio.wait_for(client.ping(), timeout=0.5)
        except Exception as exc:
            await client.aclose()
            _retry_after = time.monotonic() + 5
            if not _down_logged:
                _down_logged = True
                logger.warning(
                    "Redis unavailable (%s); voice events dropped until it returns",
                    exc,
                )
            return None
        _down_logged = False
        _retry_after = 0.0
        _client = client
        logger.info("Redis publisher connected (%s)", settings.redis_channel)
        return _client


async def _publish(payload: dict) -> None:
    global _client, _retry_after
    client = await _client_or_none()
    if client is None:
        return
    try:
        await client.publish(get_settings().redis_channel, json.dumps(payload))
    except Exception as exc:
        logger.warning("Redis publish failed: %s", exc)
        _retry_after = time.monotonic() + 5
        stale = _client
        _client = None
        if stale is not None:
            try:
                await stale.aclose()
            except Exception:
                pass


async def close_publisher() -> None:
    global _client
    client = _client
    _client = None
    if client is not None:
        await client.aclose()
