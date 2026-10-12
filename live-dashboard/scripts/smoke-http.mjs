import WebSocket from "ws";

const BASE = "http://127.0.0.1:4000";
const frames = [];

const ws = new WebSocket("ws://127.0.0.1:4000/api/v1/stream/dashboard");
ws.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});

const post = async (body) => {
  const res = await fetch(`${BASE}/api/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return `${res.status}`;
};

console.log("transcription:", await post({
  CallSID: "CA-1001",
  type: "transcription",
  data: { role: "customer", text: "Seltos ka on-road price kya hai?" },
}));
console.log("assistant   :", await post({
  call_sid: "CA-1001",
  type: "transcription",
  data: { role: "assistant", text: "Seltos HTK+ is 14.2 lakh on-road." },
}));
console.log("sentiment   :", await post({
  CallSID: "CA-1001",
  type: "sentiment",
  data: { score: 178, intent: "pricing_enquiry" },
}));
console.log("status      :", await post({
  CallSID: "CA-1001",
  type: "status",
  data: { status: "completed" },
}));
console.log("empty (422) :", await post({ CallSID: "CA-1001", type: "sentiment", data: {} }));
console.log("bogus (400) :", await post({ type: "sentiment", data: { score: 1 } }));

await new Promise((r) => setTimeout(r, 200));

console.log("\nframes received:", frames.map((f) => f.type).join(", "));
const last = frames.at(-1).call;
console.log("final call   :", JSON.stringify({
  callSid: last.callSid,
  status: last.status,
  sentiment: last.sentiment,
  lastIntent: last.lastIntent,
  lines: last.transcript.length,
}));

const rest = await (await fetch(`${BASE}/api/v1/calls`)).json();
console.log("GET /calls   :", rest.calls.length, "call(s)");
console.log("404 check    :", (await fetch(`${BASE}/api/v1/calls/nope`)).status);
console.log("health       :", JSON.stringify(await (await fetch(`${BASE}/health`)).json()));

ws.close();
