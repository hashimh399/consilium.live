# Consilium

Dealership voice agent for [consilium.live](https://consilium.live). It answers inbound
calls in English, Hindi, and Hinglish, looks the caller up, books test drives and
service, handles roadside assistance, and streams a live telemetry board.

## Architecture

```
Phone (Exotel / Twilio)
      │  inbound call
      ▼
FastAPI  /voice/incoming ── TwiML ──► media stream WebSocket
      │
      └─ WebSocket (8 kHz audio)
              │  caller audio ──► Deepgram STT (nova-3, language=multi) ──► text
              │                                            │
              │  ◄─ pcm ── Cartesia TTS (sonic-3.6) ◄── text ──┤
              │                                            ▼
              │                                   Groq LLM (key pool)
              │                                     ├─ knowledge base
              │                                     ├─ tools → SQLite
              │                                     └─ intent / persona
              │
              └─ Redis voice_agent_events
                    ├─ live-dashboard (port 4000)
                    ├─ notifications (WhatsApp + email)
                    └─ dashboard REST for Next.js (port 3000)
```

| Layer | Service | Port |
|---|---|---|
| Voice agent | Python FastAPI | 8000 |
| Caller directory | `crm` | 8080 |
| Live telemetry HUD | `live-dashboard` | 4000 |
| Dealership dashboard | Next.js `dashboard` | 3000 |
| Notifications | `notifications` | none (Redis subscriber) |
| Event bus | Redis | 6379 |

## Project structure

```
.
├── backend/                 Voice loop, tools, knowledge, mock DMS
├── crm/                     Caller lookup for demo ANIs
├── live-dashboard/          Live-call HUD (Redis → WebSocket → HTML)
├── notifications/           RSA WhatsApp + manager email
├── dashboard/               Next.js ops board
└── README.md
```

## Setup

Copy `backend/.env.example` to `backend/.env` and fill in Groq, Deepgram,
Cartesia, and Twilio/Exotel keys. Never commit `.env` files.

```bash
cd backend
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

```bash
cd crm && npm install && npm run dev          # :8080
cd live-dashboard && npm install && npm run dev   # :4000
cd notifications && npm install && npm run dev
cd dashboard && npm install && npm run dev    # :3000
```

Health check: http://localhost:8000/health  
Live HUD: http://localhost:4000/  
Ops board: http://localhost:3000/

Demo callers:

- `6005802921` — Arjun Sharma, Seltos HTX, PAL Jay Jammu
- `9906358704` — Sarah Khan, hot lead, PAL Jay Srinagar

## Knowledge

Everything the agent is allowed to say about the dealership lives in
`backend/app/knowledge/data.yaml`. Restart the voice agent after editing it.

The agent never quotes prices, discounts, or EMI figures. Stock and GPS come
from tools, not from the model.
