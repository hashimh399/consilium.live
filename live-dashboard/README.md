# Consilium live dashboard

Realtime dashboard backend for the Consilium voice agent. It listens on a Redis
channel for voice-agent events, keeps the state of every live call in memory,
and pushes each change to connected dashboard UIs over WebSockets.

```
voice agent  ──publish──>  Redis "voice_agent_events"  ──subscribe──>  live-dashboard  ──ws──>  dashboard UI
```

## Run it

```bash
npm install
cp .env.example .env      # optional; defaults work on localhost
npm run dev               # tsx watch, http://localhost:4000
```

Production: `npm run build && npm start`.

Redis is optional at boot. If it is not reachable the HTTP and WebSocket
surface still comes up and ioredis keeps retrying in the background.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `4000` | HTTP/WS port |
| `LOG_LEVEL` | `info` | Pino level |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated origins, or `*` |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `REDIS_CHANNEL` | `voice_agent_events` | Channel to subscribe to |

## WebSocket API

Connect to `ws://localhost:4000/api/v1/stream/dashboard`.

On connect the server sends the full state of every tracked call:

```json
{
  "type": "snapshot",
  "at": "2026-09-28T09:15:00.000Z",
  "calls": [
    {
      "callSid": "CA-1001",
      "status": "active",
      "transcript": [
        { "role": "customer", "text": "Seltos ka price kya hai?", "at": "..." }
      ],
      "sentiment": 72,
      "lastIntent": "pricing_enquiry",
      "startedAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

After that, every change produces one frame for the affected call:

```json
{ "type": "call.update", "at": "...", "call": { "...": "same shape as above" } }
```

The socket is read-only, except that a client may send
`{"type":"refresh"}` to request a fresh snapshot. Dead sockets are dropped by
a 30s ping/pong heartbeat.

## Event format

Publish JSON to `voice_agent_events`. The call identifier is accepted as
`CallSID`, `CallSid`, `callSid`, `call_sid`, `SessionID`, `sessionId` or
`session_id`, so the Python agent's snake_case spelling works as-is.

```jsonc
// transcript line (role defaults to "customer")
{ "CallSID": "CA-1001", "type": "transcription",
  "data": { "role": "assistant", "text": "Seltos HTK+ is 14.2 lakh on-road." } }

// sentiment score, clamped to 0-100
{ "CallSID": "CA-1001", "type": "sentiment", "data": { "score": 78 } }

// intent, also accepted inline on transcription and sentiment payloads
{ "CallSID": "CA-1001", "type": "intent", "data": { "intent": "book_test_drive" } }

// lifecycle
{ "CallSID": "CA-1001", "type": "status", "data": { "status": "completed" } }
```

A quick publish from the Python side:

```python
redis.publish("voice_agent_events", json.dumps({
    "CallSID": call_sid,
    "type": "transcription",
    "data": {"role": "customer", "text": transcript},
}))
```

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /health` | Status, tracked call count, connected dashboard count |
| `GET /api/v1/calls` | All tracked calls, newest activity first |
| `GET /api/v1/calls/:callSid` | One call, `404` if unknown |
| `POST /api/v1/events` | Inject an event as if it came from Redis |

`POST /api/v1/events` takes the same body as a Redis message, which makes it
easy to drive the UI without a Redis server:

```bash
curl -X POST http://localhost:4000/api/v1/events \
  -H 'content-type: application/json' \
  -d '{"CallSID":"CA-1001","type":"sentiment","data":{"score":78}}'
```

## Smoke tests

```bash
npm run smoke:http    # needs the dev server running; drives it over HTTP + WS
npm run smoke:redis   # self-contained: fake Redis pub/sub -> store -> WS
```

`smoke:redis` stands up a minimal RESP server so the Redis subscriber path can
be exercised without installing Redis.

## Layout

```
src/
  server.ts                  bootstrap + graceful shutdown
  app.ts                     Fastify instance, plugins, wiring
  config.ts                  env parsing
  types.ts                   shared types + event parsing
  store/call-store.ts        in-memory call state
  realtime/hub.ts            connected dashboard sockets + broadcast
  realtime/apply-event.ts    folds an event into the store
  realtime/redis-subscriber.ts  Redis -> store -> broadcast
  routes/calls.ts            health + REST + event injection
  routes/dashboard-stream.ts /api/v1/stream/dashboard
scripts/                     smoke tests
```

Call state lives in a plain `Map` and is lost on restart, which is what the
demo wants. `CallStore.prune(maxAgeMs)` is available if completed calls should
be evicted over time.
