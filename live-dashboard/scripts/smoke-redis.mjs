// Minimal fake Redis pub/sub server: enough RESP to prove the real
// subscriber wiring works without installing Redis.
import net from "node:net";
import WebSocket from "ws";

import { buildApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";

const PORT = 6399;
const CHANNEL = "voice_agent_events";
let subscriber = null;

const bulk = (s) => `$${Buffer.byteLength(s)}\r\n${s}\r\n`;

const redis = net.createServer((socket) => {
  socket.on("data", (chunk) => {
    const parts = chunk.toString().split("\r\n").filter((l) => l && !l.startsWith("*") && !l.startsWith("$"));
    const cmd = (parts[0] ?? "").toLowerCase();
    if (cmd === "info") socket.write(bulk("# Server\r\nloading:0\r\n"));
    else if (cmd === "subscribe") {
      subscriber = socket;
      socket.write(`*3\r\n${bulk("subscribe")}${bulk(parts[1])}:1\r\n`);
    } else socket.write("+OK\r\n");
  });
});
await new Promise((r) => redis.listen(PORT, "127.0.0.1", r));

const config = { ...loadConfig(), port: 4010, logLevel: "warn", redisUrl: `redis://127.0.0.1:${PORT}` };
const { app } = await buildApp(config);
await app.listen({ host: "127.0.0.1", port: config.port });

const ws = new WebSocket(`ws://127.0.0.1:${config.port}/api/v1/stream/dashboard`);
const frames = [];
ws.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
await new Promise((r) => ws.once("open", r));

for (let i = 0; i < 40 && !subscriber; i++) await new Promise((r) => setTimeout(r, 100));
console.log("subscribed via RESP:", subscriber !== null);

const publish = (payload) => {
  const json = JSON.stringify(payload);
  subscriber.write(`*3\r\n${bulk("message")}${bulk(CHANNEL)}${bulk(json)}`);
};

publish({ CallSID: "CA-2002", type: "transcription", data: { text: "Carens test drive book karni hai" } });
publish({ CallSID: "CA-2002", type: "sentiment", data: { score: 84 } });
publish({ CallSID: "CA-2002", type: "intent", data: { intent: "book_test_drive" } });
publish({ nonsense: true });

await new Promise((r) => setTimeout(r, 400));

console.log("frames:", frames.map((f) => f.type).join(", "));
console.log("call  :", JSON.stringify(frames.at(-1).call));

ws.close();
await app.close();
subscriber?.destroy();
redis.close();
process.exit(0);
