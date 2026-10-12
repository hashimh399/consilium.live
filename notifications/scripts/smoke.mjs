// Minimal fake Redis pub/sub server: enough RESP to drive the real subscriber
// without installing Redis.
import net from "node:net";

import { loadConfig } from "../dist/config.js";
import { createLogger } from "../dist/logger.js";
import { startSubscriber } from "../dist/redis/subscriber.js";
import { SentimentTracker } from "../dist/state/sentiment-tracker.js";

const PORT = 6398;
const CHANNEL = "voice_agent_events";
let sub = null;

const bulk = (s) => `$${Buffer.byteLength(s)}\r\n${s}\r\n`;

const redis = net.createServer((socket) => {
  socket.on("data", (chunk) => {
    const parts = chunk
      .toString()
      .split("\r\n")
      .filter((l) => l && !l.startsWith("*") && !l.startsWith("$"));
    const cmd = (parts[0] ?? "").toLowerCase();
    if (cmd === "info") socket.write(bulk("# Server\r\nloading:0\r\n"));
    else if (cmd === "subscribe") {
      sub = socket;
      socket.write(`*3\r\n${bulk("subscribe")}${bulk(parts[1])}:1\r\n`);
    } else socket.write("+OK\r\n");
  });
});
await new Promise((r) => redis.listen(PORT, "127.0.0.1", r));

// Failure rate is flipped mid-run, so the happy paths stay deterministic and
// the retry path is exercised on its own.
const config = {
  ...loadConfig({ LOG_PRETTY: "true", NOTIFY_MAX_ATTEMPTS: "3" }),
  redisUrl: `redis://127.0.0.1:${PORT}`,
  mockFailureRate: 0,
};
const log = createLogger(config);
const subscriber = startSubscriber({ config, log, sentiment: new SentimentTracker() });

for (let i = 0; i < 40 && !sub; i++) await new Promise((r) => setTimeout(r, 100));
console.log(`\n=== subscribed: ${sub !== null} ===\n`);

const publish = (payload) =>
  sub.write(`*3\r\n${bulk("message")}${bulk(CHANNEL)}${bulk(JSON.stringify(payload))}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("--- 1. sentiment arrives first and is remembered ---");
publish({ CallSID: "CA-7001", type: "sentiment", data: { score: 22 } });
await wait(150);

console.log("\n--- 2. rsa_confirmed -> WhatsApp + manager email (low score = URGENT) ---");
publish({
  CallSID: "CA-7001",
  type: "rsa_confirmed",
  data: {
    GPS: { lat: 28.567512, lng: 77.243118, address: "Ring Road near Lajpat Nagar IV" },
    callerNumber: "9812345678",
    notes: "Flat tyre, car is on the shoulder",
  },
});
await wait(1500);

console.log("\n--- 3. duplicate rsa_confirmed is ignored ---");
publish({
  CallSID: "CA-7001",
  type: "rsa_confirmed",
  data: { GPS: "28.567512,77.243118", callerNumber: "+919812345678" },
});
await wait(500);

console.log("\n--- 4. malformed payloads are logged and skipped ---");
publish({ CallSID: "CA-7002", type: "rsa_confirmed", data: { callerNumber: "9812345678" } });
publish({ nonsense: true });
await wait(500);

console.log("\n--- 5. unscored call still alerts, marked 'not scored' ---");
publish({
  call_sid: "CA-7003",
  type: "rsa_confirmed",
  data: { location: [28.4595, 77.0266], from: "+919900112233" },
});
await wait(1500);

console.log("\n--- 6. provider outage: every attempt fails, both channels report it ---");
config.mockFailureRate = 1;
publish({
  CallSID: "CA-7004",
  type: "rsa_confirmed",
  data: { gps: "28.6139,77.2090", callerNumber: "9800011122" },
});
await wait(4000);

await subscriber.close();
sub?.destroy();
redis.close();
process.exit(0);
