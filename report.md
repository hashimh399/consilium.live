# Consilium Voice Agent — Improvement Report

**Date:** 2026-09-10

## Overview

A series of fixes were made to improve the voice call experience, addressing the
caller's accent recognition, premature/interrupting responses, broken audio, and
high latency / rate-limiting.

---

## 1. Accent Recognition (STT)

**Problem:** The agent struggled to understand the caller's Indian English accent
and misheard domain words (e.g. "Sonnet" instead of "Sonet").

**Changes (`backend/app/services/stt.py`, `.env`):**
- Set `language=en-IN` (Indian English locale).
- Switched STT model to `nova-2-phonecall` (phone-audio optimized).
- Added a `keyterm` list (`Sonet, Seltos, Carens, Syros, EV6, test drive, PAL Jay, …`)
  to boost recognition of dealership-specific terms.
- Made `keyterm` conditional: it is skipped for `-phonecall` models, which do not
  support it (previously caused a Deepgram `HTTP 400`).

## 2. Turn-Taking / Not Cutting Off the Caller

**Problem:** The agent responded on short pauses and interrupted the caller
mid-sentence.

**Changes (`backend/app/services/stt.py`, `telephony.py`):**
- Increased Deepgram `endpointing` from `500ms` → `800ms`.
- Added an end-of-turn debounce: final transcripts are buffered and only sent to
  the agent after `700ms` of silence or a Deepgram `UtteranceEnd` VAD event.

## 3. Barge-In / Broken Voice

**Problem:** The agent's own speech kept being cleared mid-sentence, so callers
couldn't hear complete sentences.

**Cause:** Barge-in triggered on any `SpeechStarted` VAD event (noise, echo, filler).

**Changes (`backend/app/services/telephony.py`):**
- Barge-in now only triggers on *real transcribed speech*:
  - an interim transcript of ≥ 5 characters while speaking, or
  - an actual final transcript.
- Pure VAD noise no longer cuts off the agent.

## 4. Caller Context

**Problem:** The agent asked for the caller's phone number even though the
dashboard already had it.

**Changes (`backend/app/services/agent.py`, `telephony.py`):**
- The caller's number (from Twilio) is now injected into the system prompt, so
  the agent uses it instead of re-asking.

## 5. Latency & Rate Limits

**Problem:** High latency and repeated `429` rate-limit errors from the LLM.

**Changes (`backend/app/services/agent.py`, `llm.py`):**
- Trimmed conversation history to the system prompt + last 20 messages (bounds
  tokens per request).
- Added retry/backoff (up to 3 attempts, honoring `retry-after`) on rate-limit
  and connection errors.

## 6. LLM Provider: Groq → DeepSeek

**Problem:** Groq free tier rate-limited every model that supported tool calling
and JSON output (`gpt-oss-120b`, `qwen3.8-27b`), and several available models
(`prompt-guard`, `compound`, `whisper`, `orpheus`) lacked tool calling or JSON
support entirely.

**Changes (`backend/app/config.py`, `services/llm.py`, `services/summarizer.py`,
`main.py`, `.env`):**
- Switched to DeepSeek's OpenAI-compatible API (`deepseek-chat`), which supports
  both tool calling and JSON output with generous limits.
- Replaced the Groq SDK with a direct `httpx` client in `llm.py`.
- `summarizer.py` now uses a shared `chat_json()` helper.
- `/health` endpoint now reports the DeepSeek key instead of Groq.

## 7. Dashboard (separate issue)

**Problem:** `npm run dev` panicked with a Turbopack "conflicting effects" error.

**Cause:** Corrupted Turbopack persistent filesystem cache (`.next/cache`).

**Fix:** Cleared `.next` (verified `next build` and `next dev` run cleanly).
Recurrence can be prevented by setting `turbopackFileSystemCache: false` in
`next.config.ts` if needed.

---

## Files Changed

| File | Change |
|------|--------|
| `backend/app/services/stt.py` | en-IN locale, endpointing, keyterms |
| `backend/app/services/telephony.py` | turn debounce, transcript-based barge-in, caller number |
| `backend/app/services/agent.py` | caller number injection, history trimming |
| `backend/app/services/llm.py` | DeepSeek client + retry/backoff |
| `backend/app/services/summarizer.py` | use shared `chat_json()` |
| `backend/app/config.py` | DeepSeek settings |
| `backend/app/main.py` | health endpoint |
| `backend/.env` | DeepSeek key, model names |
| `dashboard/.next` | cleared corrupted cache (not code) |

## Remaining Notes

- The TTS model (`aura-arcas-en`) and STT model (`nova-2-phonecall`) were chosen
  by the user and left as-is.
- Optional follow-up: the model still occasionally asks multiple questions at
  once; the "one question at a time" prompt rule could be reinforced further if
  desired.
