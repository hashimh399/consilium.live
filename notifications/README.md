# Consilium notifications

Listens on the same `voice_agent_events` Redis channel as the dashboard. When
the voice agent confirms a Roadside Assistance request, this service messages
the customer on WhatsApp and emails the dealership manager.

```
voice agent ──publish──> Redis "voice_agent_events" ──┬──> live-dashboard   (live UI)
                                                      └──> notifications (WhatsApp + email)
```

Both services subscribe independently, so neither one can starve the other.

## Run it

```bash
npm install
cp .env.example .env    # optional; the defaults run fully mocked
npm run dev
```

Production: `npm run build && npm start`.

Redis does not have to be up at boot — ioredis reconnects and re-subscribes
on its own.

## Mock vs. real delivery

`DELIVERY_TRANSPORT=mock` (the default) builds the exact URL, headers and body
the provider would receive, logs a redacted summary, and returns a fake
reference id. Nothing leaves the process. Flip to `DELIVERY_TRANSPORT=http`
and the identical request is actually sent — no other code changes.

At boot with `http`, missing credentials for the selected providers abort
startup rather than failing silently on the first real RSA call.

`MOCK_FAILURE_RATE` (0..1) makes the mock transport fail randomly, which is
how the retry and partial-failure paths are exercised in the smoke test.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `REDIS_CHANNEL` | `voice_agent_events` | Channel to subscribe to |
| `DELIVERY_TRANSPORT` | `mock` | `mock` or `http` |
| `MOCK_FAILURE_RATE` | `0` | Simulated failure rate for the mock transport |
| `NOTIFY_MAX_ATTEMPTS` | `3` | Attempts per channel before giving up |
| `NOTIFY_TIMEOUT_MS` | `8000` | Per-attempt timeout |
| `WHATSAPP_PROVIDER` | `meta` | `meta` (Cloud API) or `twilio` |
| `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, `META_GRAPH_VERSION` | — | Meta credentials |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `WHATSAPP_FROM` | — | Twilio credentials |
| `EMAIL_PROVIDER` | `sendgrid` | `sendgrid` or `smtp` |
| `EMAIL_FROM`, `MANAGER_EMAIL`, `SENDGRID_API_KEY`, `SMTP_URL` | — | Email settings |
| `LOG_LEVEL`, `LOG_PRETTY` | `info`, `true` | Logging |

## The event it acts on

Publish to `voice_agent_events`:

```json
{
  "CallSID": "CA-7001",
  "type": "rsa_confirmed",
  "data": {
    "GPS": { "lat": 28.567512, "lng": 77.243118, "address": "Ring Road, Lajpat Nagar IV" },
    "callerNumber": "9812345678",
    "notes": "Flat tyre, car is on the shoulder"
  }
}
```

Tolerated spellings, because the Python agent and Twilio disagree:

- call id — `CallSID`, `CallSid`, `callSid`, `call_sid`, `SessionID`, `sessionId`, `session_id`
- coordinates — `GPS`, `gps`, `coordinates`, `location`; as `"28.56,77.24"`, `[28.56, 77.24]`,
  `{lat,lng}`, `{latitude,longitude}`, or `{lat,lon}`
- caller — `callerNumber`, `caller_number`, `from`, `From`, `phone`, `phoneNumber`

Bare 10-digit numbers are normalised to `+91`. Latitude/longitude outside
valid range is rejected.

### Where the sentiment score comes from

An `rsa_confirmed` payload carries the location and the caller, not the mood
of the call. The service therefore also watches `sentiment` events on the same
channel and keeps the latest score per call (6h TTL), replaying it into the
manager alert. A score below 40 marks the email `[URGENT]`. A call that was
never scored is reported as "not scored" rather than guessed at.

## Notification functions

```ts
sendWhatsAppConfirmation(phoneNumber: string, coordinates: Coordinates, ctx): Promise<NotificationResult>
sendEmailAlert(callSid: string, coordinates: Coordinates, sentimentScore: number | null, ctx): Promise<NotificationResult>
```

`ctx` carries the config and logger. Neither function throws — each returns a
`NotificationResult` with `ok`, `attempts`, `durationMs`, and either a
provider `reference` or an `error`. They run concurrently, so a WhatsApp
outage cannot stop the dealership from hearing about a stranded customer.

## Error handling

Failures are classified before they are retried: 408, 429 and 5xx get another
attempt, other 4xx do not, because a rejected payload will be rejected again.
Retries use exponential backoff with full jitter, and every attempt is logged
with its status, duration and attempt number.

Each attempt is bounded by `NOTIFY_TIMEOUT_MS` via `AbortSignal`, so a hung
provider cannot stall the subscriber. Phone numbers, email addresses, tokens
and API keys are redacted in logs. A dispatch where every channel failed
releases its dedupe entry so a re-published event is retried, while a
successful one is remembered and duplicates are dropped. `unhandledRejection`
and `uncaughtException` are both trapped at the top level.

## Smoke test

```bash
npm run smoke
```

Stands up a minimal fake Redis so the real subscriber path runs without a
Redis server, and walks six scenarios: sentiment capture, a full dispatch,
duplicate suppression, malformed payloads, an unscored call, and a total
provider outage.

## Layout

```
src/
  index.ts                     entry point, boot checks, shutdown
  config.ts                    env parsing + credential validation
  logger.ts                    pino + PII redaction/masking
  types.ts                     Coordinates, RsaConfirmedEvent, NotificationResult
  events.ts                    channel payload parsing and normalisation
  redis/subscriber.ts          subscribe, route events, dedupe
  state/sentiment-tracker.ts   last sentiment score per call
  notifications/
    whatsapp.ts                sendWhatsAppConfirmation (Meta / Twilio)
    email.ts                   sendEmailAlert (SendGrid / SMTP)
    dispatch.ts                fans one RSA event to both channels
  delivery/
    transport.ts               mock + http senders
    retry.ts                   backoff with jitter
    errors.ts                  DeliveryError, retryable classification
scripts/smoke.mjs
```

## Going live

- **WhatsApp** — the Meta and Twilio request builders are already correct;
  set `DELIVERY_TRANSPORT=http` and supply credentials. Meta requires an
  approved template for the first message outside a 24h session window.
- **Email** — SendGrid works as-is. The SMTP path is a mock only; install
  `nodemailer` and replace `buildSmtpRequest` with `transporter.sendMail()`.
  Choosing `smtp` with `http` fails fast with that message rather than
  pretending to send.
