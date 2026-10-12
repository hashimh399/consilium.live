"""Speech synthesis through Cartesia Sonic."""

import logging

import httpx

from app.config import get_settings
from app.services.tts_persona import TtsPersona, persona_for_label

logger = logging.getLogger("voice_agent.tts")

_CARTESIA_URL = "https://api.cartesia.ai/tts/bytes"
_CARTESIA_VERSION = "2026-08-14"
# sonic-multilingual is sunset. sonic-3.6 is a current model and still speaks Hindi.
_CARTESIA_MODEL = "sonic-3.6"
_CARTESIA_LANGUAGE = "hi"


def _prosody(persona: TtsPersona) -> dict[str, float | str]:
    return {
        "speed": persona.speed,
        "volume": persona.volume,
        "emotion": persona.emotion,
    }


def _cartesia_body(text: str, persona: TtsPersona, voice_id: str) -> dict:
    return {
        "model_id": _CARTESIA_MODEL,
        "transcript": text,
        "voice": {"id": voice_id},
        "language": _CARTESIA_LANGUAGE,
        "output_format": {
            "container": "raw",
            "encoding": "pcm_s16le",
            "sample_rate": 8000,
        },
        "generation_config": _prosody(persona),
    }


def _as_codec(pcm: bytes, encoding: str) -> bytes:
    """Cartesia returns 8 kHz linear16. Twilio still needs mulaw on the wire."""
    if encoding != "mulaw":
        return pcm
    import audioop

    if len(pcm) % 2:
        pcm = pcm[:-1]
    return audioop.lin2ulaw(pcm, 2)


async def synthesize_cartesia_audio(
    text: str,
    persona_profile: str,
    *,
    encoding: str = "linear16",
    http_client: httpx.AsyncClient | None = None,
) -> bytes:
    """Speak one line with sonic-3.6 in Hindi."""
    settings = get_settings()
    if not settings.cartesia_api_key:
        logger.warning("Cartesia sonic-3.6 unavailable: CARTESIA_API_KEY is not set")
        raise RuntimeError("CARTESIA_API_KEY is not set")
    persona = persona_for_label(persona_profile)
    headers = {
        "Authorization": f"Bearer {settings.cartesia_api_key}",
        "Cartesia-Version": _CARTESIA_VERSION,
        "Content-Type": "application/json",
    }
    body = _cartesia_body(text, persona, settings.cartesia_voice_id)

    async def _post(client: httpx.AsyncClient) -> bytes:
        response = await client.post(_CARTESIA_URL, headers=headers, json=body)
        if response.status_code >= 400:
            detail = response.text[:180].replace("\n", " ")
            logger.warning(
                "Cartesia sonic-3.6 unavailable (%s, %s, speed %s). %s",
                response.status_code,
                persona.emotion,
                persona.speed,
                detail,
            )
            response.raise_for_status()
        if not response.content:
            logger.warning("Cartesia sonic-3.6 returned empty audio")
            raise RuntimeError("Cartesia returned empty audio")
        return _as_codec(response.content, encoding)

    if http_client is None:
        async with httpx.AsyncClient(timeout=30.0) as client:
            return await _post(client)
    return await _post(http_client)


async def synthesize(
    text: str,
    encoding: str = "mulaw",
    http_client: httpx.AsyncClient | None = None,
    persona: TtsPersona | None = None,
) -> tuple[bytes, str]:
    """Speak with the active Hinglish persona. A Cartesia failure is logged and raised."""
    profile = persona or persona_for_label("Baseline (Hinglish)")
    audio = await synthesize_cartesia_audio(
        text,
        profile.label,
        encoding=encoding,
        http_client=http_client,
    )
    return audio, profile.label
