"""ANI lookup against the local caller directory.

This runs once, at call start, and is finished before the greeting is spoken.
A missing directory must not stop the call, so failures return None.
"""

import logging
from dataclasses import dataclass

import httpx

from app.config import get_settings

logger = logging.getLogger("voice_agent.caller_lookup")

# Shown on the live-call HUD when the directory has no row for this number.
NO_CRM_MATCH = "(No CRM Match)"


@dataclass(frozen=True)
class CallerLookup:
    """One finished directory read. `data` is set only for a named match."""

    matched: bool
    source: str
    data: dict | None

# Fail fast. A closed port or a slow CRM must not hold the greeting.
_LOOKUP_TIMEOUT_S = 0.8
_client: httpx.Client | None = None


def _lookup_client() -> httpx.Client:
    """Reuse one keep-alive client so repeat lookups skip a new socket."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.Client(
            timeout=httpx.Timeout(_LOOKUP_TIMEOUT_S),
            limits=httpx.Limits(max_keepalive_connections=4, max_connections=8),
        )
    return _client


def performSynchronousCallerLookup(ani: str) -> CallerLookup:
    """GET the caller profile for this ANI. A miss still carries a source label."""
    number = ani.strip()
    if not number:
        return CallerLookup(False, NO_CRM_MATCH, None)

    url = get_settings().caller_lookup_url
    try:
        response = _lookup_client().get(url, params={"ani": number})
        response.raise_for_status()
        body = response.json()
    except Exception:
        logger.warning(
            "Caller lookup timed out/unavailable. Using generic context."
        )
        return CallerLookup(False, NO_CRM_MATCH, None)

    if not isinstance(body, dict) or body.get("status") != "success":
        return CallerLookup(False, NO_CRM_MATCH, None)

    data = body.get("data")
    if not isinstance(data, dict) or not str(data.get("name") or "").strip():
        return CallerLookup(False, NO_CRM_MATCH, None)

    source = str(body.get("source") or "").strip() or "CRM"
    logger.info(
        "Caller lookup %s -> %s, %s, %s",
        number,
        data.get("name") or "unknown",
        data.get("vip_status") or "no tier",
        data.get("vehicle") or data.get("vehicle_owned") or "no vehicle",
    )
    return CallerLookup(True, source, data)
