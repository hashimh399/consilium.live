import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator

import httpx

from app.config import get_settings

logger = logging.getLogger("voice_agent")

MAX_LLM_ATTEMPTS = 3
GROQ_PRIMARY_MODEL = "openai/gpt-oss-20b"
GROQ_FALLBACK_MODEL = "qwen/qwen3.8-27b"
_RETRY_AFTER = re.compile(r"try again in ([0-9.]+)s", re.IGNORECASE)
_logged_voice_provider = False
_groq_key_index = 0
_groq_cool_until: dict[str, float] = {}


def _retry_delay(exc: Exception, attempt: int) -> float:
    """Return seconds to wait before retrying, preferring the server's Retry-After hint."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is not None:
        value = headers.get("retry-after")
        if value:
            try:
                return min(float(value), 8.0)
            except ValueError:
                pass
    return min(2 ** attempt, 8.0)


async def _completion(
    messages: list[dict],
    *,
    tools: list[dict] | None = None,
    temperature: float = 0.3,
    response_format: dict | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> dict:
    """Call the OpenAI-compatible DeepSeek chat completions endpoint with retry/backoff."""
    s = get_settings()
    payload: dict = {
        "model": s.llm_model,
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if response_format:
        payload["response_format"] = response_format

    url = s.deepseek_base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {s.deepseek_api_key}"}

    last_exc: Exception | None = None
    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=60.0)
    try:
        for attempt in range(MAX_LLM_ATTEMPTS):
            try:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code >= 400:
                    try:
                        resp.raise_for_status()
                    except httpx.HTTPStatusError as e:
                        logger.error("LLM error response: %s", e.response.text)
                        raise
                return resp.json()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in (429, 500, 502, 503, 504):
                    raise
                last_exc = exc
            except httpx.TransportError as exc:
                last_exc = exc

            if attempt == MAX_LLM_ATTEMPTS - 1:
                break
            delay = _retry_delay(last_exc, attempt)
            logger.warning("LLM request failed (%s), retrying in %.1fs", type(last_exc).__name__, delay)
            await asyncio.sleep(delay)
    finally:
        if owns_client:
            await client.aclose()

    raise last_exc  # type: ignore[misc]


async def chat(messages: list[dict], tools: list[dict] | None = None, temperature: float = 0.3) -> dict:
    """Run a chat completion and return the assistant message dict."""
    data = await _completion(messages, tools=tools, temperature=temperature)
    msg = data["choices"][0]["message"]
    return {
        "role": "assistant",
        "content": msg.get("content") or "",
        "tool_calls": [
            {
                "id": tc["id"],
                "type": "function",
                "function": {"name": tc["function"]["name"], "arguments": tc["function"]["arguments"]},
            }
            for tc in (msg.get("tool_calls") or [])
        ],
    }


def _groq_keys() -> list[str]:
    """Keys from GROQ_API_KEYS, plus GROQ_API_KEY when it is not already listed."""
    s = get_settings()
    keys: list[str] = []
    for part in (s.groq_api_keys or "").split(","):
        key = part.strip()
        if key and key not in keys:
            keys.append(key)
    single = s.groq_api_key.strip()
    if single and single not in keys:
        keys.insert(0, single)
    return keys


def _cooldown_remaining(key: str) -> float:
    return max(0.0, _groq_cool_until.get(key, 0.0) - time.monotonic())


def _mark_groq_limited(key: str, seconds: float) -> None:
    """Keep a rate-limited key out of the rotation until Groq's window clears."""
    if not key:
        return
    _groq_cool_until[key] = time.monotonic() + max(seconds, 0.0) + 0.25


def _rate_limit_seconds(exc: httpx.HTTPStatusError) -> float:
    """Seconds Groq asked us to wait. The body hint wins over a short Retry-After."""
    seconds = 0.0
    raw = exc.response.headers.get("retry-after")
    if raw:
        try:
            seconds = float(raw)
        except ValueError:
            seconds = 0.0
    match = _RETRY_AFTER.search(exc.response.text or "")
    if match:
        seconds = max(seconds, float(match.group(1)))
    if seconds <= 0:
        seconds = 8.0
    return min(seconds, 30.0)


def _select_groq_key() -> str:
    """Next key that is not cooling. If every key is cooling, the one that frees first."""
    global _groq_key_index
    keys = _groq_keys()
    if not keys:
        return ""
    now = time.monotonic()
    for offset in range(len(keys)):
        index = (_groq_key_index + offset) % len(keys)
        key = keys[index]
        if _groq_cool_until.get(key, 0.0) <= now:
            _groq_key_index = (index + 1) % len(keys)
            return key
    index = min(range(len(keys)), key=lambda i: _groq_cool_until.get(keys[i], 0.0))
    _groq_key_index = (index + 1) % len(keys)
    return keys[index]


def _bearer(headers: dict[str, str]) -> str:
    return (headers.get("Authorization") or "").removeprefix("Bearer ").strip()


def _voice_target() -> tuple[str, dict[str, str], str]:
    """Groq for the live voice loop when a key is set; otherwise streaming DeepSeek."""
    global _logged_voice_provider
    s = get_settings()
    groq_key = _select_groq_key()
    if groq_key:
        url = s.groq_base_url.rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {groq_key}"}
        model = s.groq_model or GROQ_PRIMARY_MODEL
        provider = "groq"
    else:
        url = s.deepseek_base_url.rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {s.deepseek_api_key}"}
        model = s.llm_model
        provider = "deepseek"
    if not _logged_voice_provider:
        logger.info(
            "Voice LLM provider=%s model=%s groq_keys=%s",
            provider,
            model,
            len(_groq_keys()),
        )
        _logged_voice_provider = True
    return url, headers, model


async def complete_text(
    prompt: str,
    http_client: httpx.AsyncClient | None = None,
    temperature: float = 0.1,
) -> str:
    """One short non-streaming completion on the voice provider, usually Groq."""
    url, headers, model = _voice_target()
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": 120,
    }
    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=30.0)
    try:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            logger.error("LLM error response: %s", resp.text)
            resp.raise_for_status()
        content = resp.json()["choices"][0]["message"].get("content") or ""
        return content.strip()
    finally:
        if owns_client:
            await client.aclose()


def _model_rejected(exc: httpx.HTTPStatusError) -> bool:
    """True when Groq refuses the model for this account tier."""
    if exc.response.status_code not in (400, 404):
        return False
    body = (exc.response.text or "").lower()
    return any(
        token in body
        for token in ("model_not_found", "model_decommissioned", "decommissioned", "not found")
    )


def _absorb_tool_call(slots: dict[int, dict], fragment: dict) -> None:
    index = fragment.get("index", 0)
    slot = slots.setdefault(
        index,
        {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
    )
    if fragment.get("id"):
        slot["id"] = fragment["id"]
    function = fragment.get("function") or {}
    if function.get("name"):
        slot["function"]["name"] += function["name"]
    if function.get("arguments"):
        slot["function"]["arguments"] += function["arguments"]


async def stream_chat(
    messages: list[dict],
    tools: list[dict] | None = None,
    temperature: float = 0.3,
    http_client: httpx.AsyncClient | None = None,
) -> AsyncIterator[dict]:
    """Stream a voice-loop completion.

    Yields ``{"kind": "text", "text": ...}`` for content deltas, then one
    ``{"kind": "message", "message": {...}}`` with the assembled assistant turn.
    Groq is used when configured. DeepSeek is always called with ``stream=True``.
    """
    url, headers, model = _voice_target()
    models = [model]
    if "groq.com" in url and GROQ_FALLBACK_MODEL not in models:
        models.append(GROQ_FALLBACK_MODEL)

    last_model_exc: httpx.HTTPStatusError | None = None
    for index, model_name in enumerate(models):
        try:
            async for event in _stream_model(
                url, headers, model_name, messages, tools, temperature, http_client
            ):
                yield event
            return
        except httpx.HTTPStatusError as exc:
            last_model_exc = exc
            has_fallback = index < len(models) - 1
            if has_fallback and _model_rejected(exc):
                logger.warning(
                    "Groq model %s was rejected; retrying stream with %s",
                    model_name,
                    models[index + 1],
                )
                continue
            raise
    if last_model_exc is not None:
        raise last_model_exc


async def _stream_model(
    url: str,
    headers: dict[str, str],
    model: str,
    messages: list[dict],
    tools: list[dict] | None,
    temperature: float,
    http_client: httpx.AsyncClient | None = None,
) -> AsyncIterator[dict]:
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = dict(headers)
    started = False
    last_exc: Exception | None = None
    attempt = 0
    spins = 0
    pool_size = len(_groq_keys()) if "groq.com" in url else 0
    owns_client = http_client is None
    client = http_client or httpx.AsyncClient(timeout=60.0)
    try:
        while attempt < MAX_LLM_ATTEMPTS:
            if pool_size:
                wait = _cooldown_remaining(_bearer(headers))
                if wait > 0:
                    logger.warning("Groq pool is cooling. Waiting %.1fs for a free key.", wait)
                    await asyncio.sleep(wait)
            content_parts: list[str] = []
            tool_slots: dict[int, dict] = {}
            try:
                async with client.stream("POST", url, headers=headers, json=payload) as resp:
                    if resp.status_code >= 400:
                        await resp.aread()
                        try:
                            resp.raise_for_status()
                        except httpx.HTTPStatusError as e:
                            logger.error("LLM error response: %s", e.response.text)
                            raise
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        chunk = json.loads(data)
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        text = delta.get("content") or ""
                        if text:
                            content_parts.append(text)
                            started = True
                            yield {"kind": "text", "text": text}
                        for fragment in delta.get("tool_calls") or []:
                            _absorb_tool_call(tool_slots, fragment)
                            started = True
                tool_calls = [tool_slots[i] for i in sorted(tool_slots)]
                yield {
                    "kind": "message",
                    "message": {
                        "role": "assistant",
                        "content": "".join(content_parts),
                        "tool_calls": tool_calls,
                    },
                }
                return
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429 and not started and pool_size:
                    delay = _rate_limit_seconds(exc)
                    _mark_groq_limited(_bearer(headers), delay)
                    spins += 1
                    logger.warning(
                        "429 Rate Limit hit. Cooling this Groq key for %.1fs and rotating.",
                        delay,
                    )
                    if spins <= pool_size:
                        headers["Authorization"] = f"Bearer {_select_groq_key()}"
                        continue
                    last_exc = exc
                elif exc.response.status_code not in (429, 500, 502, 503, 504) or started:
                    raise
                else:
                    last_exc = exc
            except httpx.TransportError as exc:
                if started:
                    raise
                last_exc = exc

            if attempt == MAX_LLM_ATTEMPTS - 1:
                break
            delay = _retry_delay(last_exc, attempt)
            logger.warning("LLM stream failed (%s), retrying in %.1fs", type(last_exc).__name__, delay)
            await asyncio.sleep(delay)
            attempt += 1
    finally:
        if owns_client:
            await client.aclose()

    raise last_exc  # type: ignore[misc]


async def chat_json(
    messages: list[dict],
    temperature: float = 0.2,
    http_client: httpx.AsyncClient | None = None,
) -> dict:
    """Run a completion in JSON mode and return the parsed object (with a safe fallback)."""
    data = await _completion(
        messages,
        temperature=temperature,
        response_format={"type": "json_object"},
        http_client=http_client,
    )
    content = (data["choices"][0]["message"].get("content") or "{}").strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {"intent": "Other", "summary": content, "next_action": ""}
