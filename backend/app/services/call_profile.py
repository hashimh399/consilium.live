"""Stage the ANI profile in Redis and read it back before the greeting.

The spoken opening is chosen from the value stored at `call_profile:{CallSID}`,
not from the lookup response itself. Audio is not started until that read returns.
"""

import json
import logging
from datetime import datetime

from redis import Redis

from app.config import get_settings

logger = logging.getLogger("voice_agent.call_profile")

_TTL_S = 6 * 60 * 60


def _named(profile: dict | None) -> bool:
    return bool(profile and str(profile.get("name") or "").strip())


def _filled(value: object) -> str:
    """Blank, and the CRM's N/A marker, are both missing data."""
    text = str(value or "").strip()
    if text.lower() in {"", "n/a", "na", "none", "null", "-"}:
        return ""
    return text


def stage_and_load_caller_profile(call_sid: str, profile: dict | None) -> dict | None:
    """Write the lookup result, then return whatever Redis stored."""
    key = f"call_profile:{call_sid}"
    staged = profile if _named(profile) else {"status": "unmatched"}
    settings = get_settings()
    try:
        client = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )
        try:
            client.set(key, json.dumps(staged), ex=_TTL_S)
            raw = client.get(key)
        finally:
            client.close()
    except Exception as exc:
        logger.warning("Could not stage %s: %s", key, exc)
        return None

    if not raw:
        return None
    try:
        loaded = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("call_profile %s was not JSON", key)
        return None
    if not isinstance(loaded, dict) or not _named(loaded):
        logger.info("call_profile %s has no caller match", key)
        return None
    logger.info("call_profile %s loaded for %s", key, loaded.get("name"))
    return loaded


def _month_name(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%B")
        except ValueError:
            continue
    return None


def opening_statement(profile: dict | None) -> str:
    """Spoken first line. A missing Redis profile asks the caller to identify themselves."""
    if not _named(profile):
        return (
            "Hello, thank you for calling PAL Jay. "
            "For your security, could you please confirm the full name on your registration?"
        )
    assert profile is not None
    name = str(profile.get("name") or "").strip()
    dealer = _filled(profile.get("preferred_dealer")) or "PAL Jay"
    vehicle = _filled(profile.get("vehicle")) or _filled(profile.get("vehicle_owned"))
    ownership = _filled(profile.get("ownership_type")).upper()
    bilingual = "Aap Hindi ya Hinglish mein bhi baat kar sakte hain."
    if ownership == "HOT LEAD" or not vehicle:
        return (
            f"Hello {name}, welcome to {dealer}. How can I assist you today? {bilingual}"
        )
    month = _month_name(profile.get("last_service_date"))
    if month:
        visit = f"I see we last saw you in {month} for your {vehicle}."
    else:
        visit = f"I see you drive a {vehicle}."
    electric = "ev" in vehicle.lower() or "electric" in vehicle.lower()
    close = (
        "How can I assist you with your electric journey today?"
        if electric
        else "How can I assist you today?"
    )
    return f"Welcome back to {dealer}, {name}. {visit} {close} {bilingual}"
