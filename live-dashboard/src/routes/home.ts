import type { FastifyInstance } from "fastify";

/**
 * Browser console for live calls. One self-contained page, no build step.
 * The WebSocket stays at the API path. The script builds HTML with string
 * concatenation only, because this whole page lives inside a template literal.
 */
const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Consilium | Live Call Telemetry</title>
<style>
  :root {
    color-scheme: dark;
    --brand-red: #ea0029;
    --brand-red-soft: rgba(234, 0, 41, 0.14);
    --bg: #05141f;
    --bg-2: #07192a;
    --surface: #0b1d2b;
    --surface-2: #0f2434;
    --line: #1b3144;
    --line-2: #264159;
    --ink: #eef3f7;
    --ink-2: #b7c4cf;
    --muted: #7d8f9e;
    --good: #2fbf71;
    --warn: #e5a83b;
    --radius: 12px;
    --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font: 14px/1.5 "Segoe UI", "Inter", "Helvetica Neue", Arial, sans-serif;
    background: radial-gradient(1200px 500px at 70% -10%, #0b2236 0%, var(--bg) 60%);
    color: var(--ink);
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  button { font: inherit; color: inherit; }

  /* Top bar */
  .top {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 0 28px;
    height: 64px;
    background: rgba(5, 20, 31, 0.92);
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    z-index: 5;
    backdrop-filter: blur(6px);
  }
  .top::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: -1px;
    height: 2px;
    background: linear-gradient(90deg, var(--brand-red) 0, var(--brand-red) 120px, transparent 420px);
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .mark {
    font-weight: 800;
    letter-spacing: 0.16em;
    font-size: 13px;
    color: #fff;
    background: var(--brand-red);
    padding: 7px 10px 7px 12px;
    border-radius: 3px;
  }
  .brand h1 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
  .brand p { margin: 0; font-size: 11px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
  .spacer { flex: 1; }
  .clock { font-family: var(--mono); font-size: 12px; color: var(--ink-2); }
  #conn {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-radius: 999px;
    background: var(--surface); border: 1px solid var(--line);
    font-size: 12px; font-weight: 600; color: var(--muted);
  }
  #conn .dot { width: 8px; height: 8px; border-radius: 50%; background: #55656f; }
  #conn.live { color: var(--ink); }
  #conn.live .dot { background: var(--good); box-shadow: 0 0 0 4px rgba(47, 191, 113, 0.18); }

  /* KPI strip */
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
    padding: 18px 28px 0;
  }
  .kpi {
    background: linear-gradient(180deg, var(--surface) 0, var(--bg-2) 100%);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 16px;
  }
  .kpi .label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .kpi .value { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.15; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .kpi .sub { font-size: 12px; color: var(--muted); }
  .kpi.accent { border-color: rgba(234, 0, 41, 0.5); }
  .kpi.accent .value { color: #fff; }

  /* Workspace */
  .shell {
    flex: 1;
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    gap: 18px;
    padding: 18px 28px 32px;
    min-height: 0;
  }
  .sidebar {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    display: flex; flex-direction: column;
    min-height: 420px;
    max-height: calc(100vh - 230px);
  }
  .side-head {
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
    display: flex; justify-content: space-between; align-items: center;
    font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted);
  }
  .side-list { overflow: auto; padding: 8px; display: grid; gap: 6px; align-content: start; }
  .call-item {
    text-align: left;
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 10px 12px;
    cursor: pointer;
    display: grid; gap: 6px;
  }
  .call-item:hover { background: var(--surface-2); }
  .call-item:focus-visible { outline: 2px solid var(--brand-red); outline-offset: 1px; }
  .call-item.selected { background: var(--surface-2); border-color: var(--line-2); box-shadow: inset 3px 0 0 var(--brand-red); }
  .ci-top { display: flex; align-items: center; gap: 8px; }
  .ci-name { font-weight: 700; font-size: 14px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ci-name.unverified { color: var(--ink-2); font-weight: 600; }
  .ci-sub { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .ci-sub .mono { font-family: var(--mono); }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #55656f; }
  .status-dot.active { background: var(--good); box-shadow: 0 0 0 3px rgba(47, 191, 113, 0.18); }
  .vdot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .vdot.empathy { background: #5aa9f0; }
  .vdot.upbeat { background: #ff7a18; }
  .vdot.baseline { background: #8b949e; }
  .vdot.idle { background: #33424e; }
  .side-empty { padding: 28px 18px; color: var(--muted); text-align: center; }

  .detail { display: grid; gap: 16px; align-content: start; min-width: 0; }
  .call-bar {
    display: flex; align-items: center; flex-wrap: wrap; gap: 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 18px;
  }
  .call-bar h2 { margin: 0; font-size: 20px; letter-spacing: -0.02em; }
  .call-bar .sid { font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    border-radius: 999px; padding: 3px 10px;
    background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line);
  }
  .pill.active { color: #c9f3dc; background: rgba(47, 191, 113, 0.12); border-color: rgba(47, 191, 113, 0.4); }
  .pill.completed { color: var(--muted); }
  .pill.red { color: #ffd0d6; background: var(--brand-red-soft); border-color: rgba(234, 0, 41, 0.45); }
  .gauge { margin-left: auto; min-width: 220px; }
  .gauge .row { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .gauge .row b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .gauge .bar { height: 6px; border-radius: 999px; background: var(--surface-2); margin-top: 6px; overflow: hidden; }
  .gauge .bar span { display: block; height: 100%; border-radius: 999px; }
  .gauge .bar .neg { background: var(--brand-red); }
  .gauge .bar .neu { background: var(--warn); }
  .gauge .bar .pos { background: var(--good); }

  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 18px;
    min-width: 0;
  }
  .card.crm { border-color: rgba(234, 0, 41, 0.45); background: linear-gradient(180deg, #13161f 0, var(--surface) 70%); }
  .card-title {
    display: flex; align-items: center; gap: 8px;
    margin: 0 0 12px;
    font-size: 12px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #fff;
  }
  .card-title .lock { width: 16px; height: 16px; color: var(--brand-red); flex: none; }
  .source {
    display: inline-block;
    margin: 0 0 16px;
    padding: 5px 10px;
    font-size: 12px; font-weight: 800; letter-spacing: 0.05em; color: #fff;
    background: var(--brand-red-soft);
    border: 1px solid rgba(234, 0, 41, 0.6);
    border-radius: 4px;
  }
  .who-row { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
  .avatar {
    width: 48px; height: 48px; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--brand-red); color: #fff; font-weight: 800; font-size: 17px; flex: none;
  }
  .who-row .nm { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; }
  .tier { display: inline-block; margin-top: 3px; font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; }
  .tier.gold { background: rgba(229, 168, 59, 0.16); color: #f3c969; border: 1px solid rgba(229, 168, 59, 0.5); }
  .tier.silver { background: rgba(183, 196, 207, 0.12); color: #d3dde5; border: 1px solid rgba(183, 196, 207, 0.4); }
  .tier.other { background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line); }
  .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin: 0; }
  .fields .f { padding-left: 10px; border-left: 2px solid rgba(234, 0, 41, 0.4); min-width: 0; }
  .fields .f.wide { grid-column: 1 / -1; }
  .fields dt { margin: 0; color: var(--brand-red); font-weight: 800; font-size: 12px; letter-spacing: 0.02em; }
  .fields dd { margin: 1px 0 0; font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
  .fields dd.note { font-size: 13px; font-weight: 600; color: var(--ink-2); }
  .unverified-box {
    display: grid; place-items: center; text-align: center; gap: 6px;
    padding: 26px 12px;
    border: 1px dashed rgba(234, 0, 41, 0.5);
    border-radius: 10px;
    background: rgba(234, 0, 41, 0.05);
  }
  .unverified-box b { color: var(--brand-red); letter-spacing: 0.14em; font-size: 15px; }
  .unverified-box span { color: var(--muted); font-size: 12px; }

  .kicker { font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brand-red); }
  .step-now { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin: 6px 0 10px; }
  .step-now.waiting { color: #506372; font-size: 24px; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
  .tracker { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 0; margin: 4px 0 18px; }
  .tk { position: relative; text-align: center; padding-top: 18px; padding-left: 2px; padding-right: 2px; font-size: 10px; font-weight: 700; color: #5d7181; line-height: 1.25; }
  .tk::before { content: ""; position: absolute; top: 5px; left: 0; right: 0; height: 2px; background: var(--line-2); }
  .tk:first-child::before { left: 50%; }
  .tk:last-child::before { right: 50%; }
  .tk::after { content: ""; position: absolute; top: 0; left: 50%; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: var(--bg); border: 2px solid var(--line-2); }
  .tk.seen { color: var(--ink-2); }
  .tk.seen::after { background: #6d7f8e; border-color: #6d7f8e; }
  .tk.current { color: #fff; }
  .tk.current::after { background: var(--brand-red); border-color: var(--brand-red); box-shadow: 0 0 0 5px rgba(234, 0, 41, 0.22); }

  .voice { border-radius: 10px; padding: 12px 14px; border: 1px solid transparent; }
  .voice .kicker { margin-bottom: 8px; }
  .voice-row { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 17px; letter-spacing: -0.01em; }
  .voice svg { width: 26px; height: 26px; flex: none; }
  .voice.empathy svg { width: 48px; height: 26px; }
  .voice.empathy { background: #07182c; border-color: #1d4e89; color: #d6e8fa; box-shadow: 0 8px 26px rgba(29, 78, 137, 0.3); }
  .voice.empathy .kicker { color: #7eb6e8; }
  .voice.upbeat { background: #3d1600; border-color: #ff7a18; color: #ffe4cc; box-shadow: 0 8px 26px rgba(255, 122, 24, 0.25); }
  .voice.upbeat .kicker { color: #ff9a3c; }
  .voice.baseline { background: #1c2128; border-color: #8b949e; color: #e6edf3; }
  .voice.baseline .kicker { color: #9aa3ad; }
  .voice.idle { background: #0f1c27; border-color: var(--line); color: #5d7181; }
  .voice.upbeat svg { animation: energize 0.9s ease-in-out infinite alternate; }
  .voice.empathy svg { animation: breathe 3.2s ease-in-out infinite; }
  @keyframes energize { from { transform: translateY(1px) scale(0.96); } to { transform: translateY(-1px) scale(1.08); } }
  @keyframes breathe { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chip { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; padding: 2px 9px; border-radius: 999px; background: rgba(255, 255, 255, 0.09); }

  .trail { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
  .trail li { display: flex; gap: 8px; align-items: baseline; }
  .trail b { color: var(--ink-2); font-weight: 700; }
  .trail .t { font-family: var(--mono); color: #5d7181; min-width: 26px; }

  .tx-card { padding: 0; overflow: hidden; }
  .tx-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--line); }
  .tx-head .card-title { margin: 0; }
  .tx-head .count { font-size: 12px; color: var(--muted); }
  .tx { max-height: 380px; min-height: 160px; overflow: auto; padding: 16px 18px; display: grid; gap: 10px; align-content: start; }
  .msg { max-width: 78%; padding: 9px 13px; border-radius: 12px; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
  .msg small { display: block; font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 2px; opacity: 0.75; }
  .msg.customer { background: var(--surface-2); border: 1px solid var(--line); justify-self: start; border-bottom-left-radius: 4px; }
  .msg.assistant { background: var(--brand-red-soft); border: 1px solid rgba(234, 0, 41, 0.4); justify-self: end; border-bottom-right-radius: 4px; }
  .msg.assistant small { color: #ff8a9c; opacity: 1; }
  .tx-empty { color: var(--muted); text-align: center; padding: 34px 0; }

  .empty-state {
    display: grid; place-items: center; text-align: center; gap: 10px;
    min-height: 360px;
    background: var(--surface); border: 1px dashed var(--line-2); border-radius: var(--radius);
    color: var(--muted);
  }
  .empty-state .mark { font-size: 14px; }
  .empty-state h3 { margin: 0; color: var(--ink); font-size: 18px; }

  @media (max-width: 1100px) {
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .shell { grid-template-columns: 1fr; }
    .sidebar { max-height: 280px; min-height: 0; }
    .grid { grid-template-columns: 1fr; }
    .gauge { margin-left: 0; width: 100%; }
  }
  @media (max-width: 640px) {
    .top, .kpis, .shell { padding-left: 14px; padding-right: 14px; }
    .fields { grid-template-columns: 1fr; }
    .msg { max-width: 92%; }
  }
  @media (prefers-reduced-motion: reduce) {
    .voice.upbeat svg, .voice.empathy svg { animation: none; }
  }
</style>
</head>
<body>
<header class="top">
  <div class="brand">
    <span class="mark">C</span>
    <div>
      <h1>Live Call Telemetry</h1>
      <p>Consilium &middot; PAL Jay</p>
    </div>
  </div>
  <div class="spacer"></div>
  <span class="clock" id="clock"></span>
  <div id="conn"><span class="dot"></span><span id="conn-text">Connecting&hellip;</span></div>
</header>

<section class="kpis" id="kpis"></section>

<div class="shell">
  <aside class="sidebar">
    <div class="side-head"><span>Calls</span><span id="side-count"></span></div>
    <div class="side-list" id="side-list"></div>
  </aside>
  <main class="detail" id="detail"></main>
</div>

<script>
const conn = document.getElementById("conn");
const connText = document.getElementById("conn-text");
const kpiRoot = document.getElementById("kpis");
const sideList = document.getElementById("side-list");
const sideCount = document.getElementById("side-count");
const detailRoot = document.getElementById("detail");
const clockEl = document.getElementById("clock");

const calls = new Map();
let selectedSid = null;
let pinned = false;

const STEPS = ["Greeting", "Verifying", "Assisting", "Handling RSA", "Checking Inventory", "Sales Enquiry", "Service Booking"];

const VOICE_META = {
  empathy: { speed: "0.9x", style: "Calm / Sympathetic" },
  upbeat: { speed: "1.05x", style: "Upbeat / Energetic" },
  baseline: { speed: "1.0x", style: "Standard" },
  idle: null
};

const LOCK = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const ICONS = {
  empathy: '<svg viewBox="0 0 44 24" aria-hidden="true"><path d="M2 15c2.2-3 4.2-3.4 6.2-.6l2.2 2.2 2.4-1.2c1.6-.8 3.4-.2 4.4 1.4" fill="none" stroke="#5aa9f0" stroke-width="1.8" stroke-linecap="round"/><path d="M13.5 15.2l3.2 2.4 5.2-2.2c1.4-.6 3 .2 3.4 1.6" fill="none" stroke="#9fd0ff" stroke-width="1.8" stroke-linecap="round"/><text x="27" y="17" font-size="12" font-weight="700" font-family="Nirmala UI, Mangal, sans-serif" fill="#ffd166">\u0939\u093f</text></svg>',
  upbeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h3.2V12H4v6z" fill="#ffb347"/><path d="M10.4 18h3.2V8h-3.2v10z" fill="#ff7a18"/><path d="M16.8 18H20V5h-3.2v13z" fill="#ff4d00"/><path d="M3 9.5l5.2-3.2 4 2.2L20 4" fill="none" stroke="#fff3e0" stroke-width="1.8" stroke-linecap="round"/><path d="M17 2.6l3.2 1.3-1.4 3" fill="none" stroke="#fff3e0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  baseline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.2 4.2a3.6 3.6 0 0 0-4.8 4.6L5 13.2l1.8 1.8 1.2-1.2.2 2.2 1.8 1.8 2.2.2 1.2 1.2 1.8-1.8 4.2-4.4a3.6 3.6 0 0 0-3.2-6.6L14 8.4 15.6 6.8a3.6 3.6 0 0 0-1.4-2.6z" fill="#b6c0ca"/></svg>',
  idle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="#3b4d5b" stroke-width="1.8"/></svg>'
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function voiceTone(label) {
  const text = String(label || "").toLowerCase();
  if (!text) return "idle";
  if (text.indexOf("empathy") !== -1 || text.indexOf("calm") !== -1) return "empathy";
  if (text.indexOf("upbeat") !== -1 || text.indexOf("sales") !== -1) return "upbeat";
  return "baseline";
}

function callerName(call) {
  const name = call.profile && call.profile.name ? String(call.profile.name).trim() : "";
  return name;
}

function initials(name) {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

function shortSid(sid) {
  const text = String(sid);
  return text.length > 12 ? text.slice(0, 6) + "\u2026" + text.slice(-4) : text;
}

function formatDuration(call, now) {
  const start = Date.parse(call.startedAt);
  const end = call.status === "active" ? now : Date.parse(call.updatedAt);
  if (!isFinite(start) || !isFinite(end)) return "--:--";
  const total = Math.max(0, Math.floor((end - start) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function sentimentBand(score) {
  const value = Number(score);
  if (value < 35) return { cls: "neg", label: "Negative" };
  if (value > 65) return { cls: "pos", label: "Positive" };
  return { cls: "neu", label: "Neutral" };
}

function orderedCalls() {
  return [...calls.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

function currentCall() {
  if (pinned && selectedSid && calls.has(selectedSid)) return calls.get(selectedSid);
  const rows = orderedCalls();
  selectedSid = rows.length ? rows[0].callSid : null;
  return rows.length ? rows[0] : null;
}

/* ---------- pure HTML builders ---------- */

function kpiHtml(rows) {
  const active = rows.filter((c) => c.status === "active").length;
  const roadside = rows.filter((c) => c.lastIntent === "rsa" || c.speakingIntent === "rsa").length;
  const scores = rows.map((c) => Number(c.sentiment)).filter((n) => isFinite(n));
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const band = avg === null ? "No data yet" : sentimentBand(avg).label;
  return '' +
    '<div class="kpi accent"><div class="label">Active calls</div><div class="value">' + active + '</div><div class="sub">Live on the agent now</div></div>' +
    '<div class="kpi"><div class="label">Calls this session</div><div class="value">' + rows.length + '</div><div class="sub">' + (rows.length - active) + ' completed</div></div>' +
    '<div class="kpi"><div class="label">Avg sentiment</div><div class="value">' + (avg === null ? "--" : avg) + '</div><div class="sub">' + band + '</div></div>' +
    '<div class="kpi"><div class="label">Roadside calls</div><div class="value">' + roadside + '</div><div class="sub">Handled in calm mode</div></div>';
}

function sideItemHtml(call, selected) {
  const name = callerName(call);
  const tone = voiceTone(call.voiceProfileUsed);
  const step = call.speakingStep ? escapeHtml(call.speakingStep) : "Waiting";
  return '<button class="call-item' + (selected ? ' selected' : '') + '" data-sid="' + escapeHtml(call.callSid) + '">' +
    '<div class="ci-top"><span class="status-dot ' + escapeHtml(call.status) + '"></span>' +
    '<span class="ci-name' + (name ? '' : ' unverified') + '">' + escapeHtml(name || "Unverified caller") + '</span></div>' +
    '<div class="ci-sub"><span class="vdot ' + tone + '"></span><span>' + step + '</span></div>' +
    '<div class="ci-sub"><span class="mono">' + escapeHtml(shortSid(call.callSid)) + '</span></div>' +
    '</button>';
}

function crmCardHtml(profile) {
  const name = profile && profile.name ? String(profile.name).trim() : "";
  const source = profile && profile.source ? String(profile.source) : "(No CRM Match)";
  const head = '<h3 class="card-title">' + LOCK + '<span>CRM REAL-TIME DATA ENRICHMENT</span></h3>' +
    '<div class="source">SOURCE: ' + escapeHtml(source) + '</div>';
  if (!name) {
    return '<section class="card crm">' + head +
      '<div class="unverified-box"><b>IDENTITY UNVERIFIED</b><span>The lookup ran and found no record for this number.</span></div></section>';
  }
  const tier = profile.vipStatus ? String(profile.vipStatus) : "";
  const tierCls = tier.toLowerCase() === "gold" ? "gold" : (tier.toLowerCase() === "silver" ? "silver" : "other");
  const vehicle = profile.vehicleOwned || profile.vehicle || "\u2014";
  const fields =
    field("Name", name) +
    field("Vehicle Owned", vehicle) +
    field("VIN Last 4", profile.vinLast4 || "\u2014") +
    field("ownership_type", profile.ownershipType || "\u2014") +
    field("last_service_date", profile.lastServiceDate || "\u2014") +
    field("preferred_dealer", profile.preferredDealer || "\u2014") +
    (profile.lastServicePackage ? field("last_service_package", profile.lastServicePackage) : "") +
    (profile.nextService ? field("next_service", profile.nextService) : "") +
    (profile.interestNotes ? field("interest_notes", profile.interestNotes, true) : "");
  return '<section class="card crm">' + head +
    '<div class="who-row"><div class="avatar">' + escapeHtml(initials(name)) + '</div><div><div class="nm">' +
    escapeHtml(name) + '</div>' + (tier ? '<span class="tier ' + tierCls + '">' + escapeHtml(tier) + '</span>' : '') +
    '</div></div><dl class="fields">' + fields + '</dl></section>';
}

function field(label, value, wide) {
  return '<div class="f' + (wide ? ' wide' : '') + '"><dt>' + label + '</dt><dd' + (wide ? ' class="note"' : '') + '>' +
    escapeHtml(value) + '</dd></div>';
}

function agentCardHtml(call) {
  const step = call.speakingStep ? String(call.speakingStep) : "";
  const voice = call.voiceProfileUsed ? String(call.voiceProfileUsed) : "";
  const tone = voiceTone(voice);
  const trailRows = call.stepTrail || [];
  const seen = new Set(trailRows.map((entry) => entry.step));
  const known = STEPS.indexOf(step) === -1 && step ? STEPS.concat([step]) : STEPS;
  const nodes = known.map((name) => {
    const cls = name === step ? "current" : (seen.has(name) ? "seen" : "");
    return '<div class="tk ' + cls + '">' + escapeHtml(name) + '</div>';
  }).join("");
  const badges =
    (call.speakingTurn !== null && call.speakingTurn !== undefined
      ? '<span class="pill">Turn ' + escapeHtml(call.speakingTurn) + '</span>' : '') +
    (call.speakingIntent ? '<span class="pill red">Intent ' + escapeHtml(call.speakingIntent) + '</span>' : '');
  const meta = VOICE_META[tone];
  const chips = meta
    ? '<div class="chips"><span class="chip">' + meta.speed + '</span><span class="chip">' + meta.style + '</span></div>'
    : '';
  const trail = trailRows.slice().reverse().slice(0, 5).map((entry) =>
    '<li><span class="t">' + (entry.turn === null || entry.turn === undefined ? '' : 'T' + escapeHtml(entry.turn)) +
    '</span><b>' + escapeHtml(entry.step) + '</b><span>' + escapeHtml(entry.voiceProfile) + '</span></li>'
  ).join("");
  return '<section class="card"><div class="kicker">Live agent state</div>' +
    '<div class="step-now' + (step ? '' : ' waiting') + '">' + escapeHtml(step || "Waiting for the agent") + '</div>' +
    (badges ? '<div class="badges">' + badges + '</div>' : '') +
    '<div class="tracker">' + nodes + '</div>' +
    '<div class="voice ' + tone + '"><div class="kicker">VOICE PROFILE ACTIVE</div>' +
    '<div class="voice-row">' + ICONS[tone] + '<span>' + escapeHtml(voice || "\u2014") + '</span></div>' + chips + '</div>' +
    (trail ? '<ul class="trail">' + trail + '</ul>' : '') +
    '</section>';
}

function transcriptHtml(call) {
  const lines = call.transcript || [];
  const body = lines.length
    ? lines.map((line) =>
        '<div class="msg ' + (line.role === "assistant" ? "assistant" : "customer") + '"><small>' +
        (line.role === "assistant" ? "Consilium agent" : "Caller") + '</small>' + escapeHtml(line.text) + '</div>'
      ).join("")
    : '<div class="tx-empty">No transcript yet.</div>';
  return '<section class="card tx-card"><div class="tx-head"><h3 class="card-title">Live transcript</h3>' +
    '<span class="count">' + lines.length + ' message' + (lines.length === 1 ? '' : 's') + '</span></div>' +
    '<div class="tx" id="tx">' + body + '</div></section>';
}

function callBarHtml(call, now) {
  const name = callerName(call);
  const band = sentimentBand(call.sentiment);
  const score = Math.max(0, Math.min(100, Number(call.sentiment) || 0));
  const intent = call.lastIntent ? '<span class="pill">' + escapeHtml(call.lastIntent) + '</span>' : '';
  return '<div class="call-bar"><div><h2>' + escapeHtml(name || "Unverified caller") + '</h2>' +
    '<span class="sid">' + escapeHtml(call.callSid) + '</span></div>' +
    '<span class="pill ' + escapeHtml(call.status) + '">' + escapeHtml(call.status) + '</span>' + intent +
    '<span class="pill" data-duration="' + escapeHtml(call.callSid) + '">' + formatDuration(call, now) + '</span>' +
    '<div class="gauge"><div class="row"><span>Sentiment &middot; ' + band.label + '</span><b>' + score + '</b></div>' +
    '<div class="bar"><span class="' + band.cls + '" style="width:' + score + '%"></span></div></div></div>';
}

function detailHtml(call, now) {
  if (!call) {
    return '<div class="empty-state"><div><span class="mark">C</span></div><h3>Waiting for the first call</h3>' +
      '<p>Live identity, agent steps, voice profile and transcript appear here as a call connects.</p></div>';
  }
  return callBarHtml(call, now) +
    '<div class="grid">' + crmCardHtml(call.profile) + agentCardHtml(call) + '</div>' +
    transcriptHtml(call);
}

/* ---------- DOM wiring ---------- */

function render() {
  const rows = orderedCalls();
  const call = currentCall();
  const now = Date.now();
  const before = document.getElementById("tx");
  const keepTop = before ? before.scrollTop : 0;
  const stick = !before || before.scrollHeight - before.scrollTop - before.clientHeight < 48;

  kpiRoot.innerHTML = kpiHtml(rows);
  sideCount.textContent = rows.length ? String(rows.length) : "";
  sideList.innerHTML = rows.length
    ? rows.map((c) => sideItemHtml(c, call !== null && c.callSid === call.callSid)).join("")
    : '<div class="side-empty">No calls yet</div>';
  detailRoot.innerHTML = detailHtml(call, now);

  const after = document.getElementById("tx");
  if (after) after.scrollTop = stick ? after.scrollHeight : keepTop;
}

function tick() {
  const now = Date.now();
  clockEl.textContent = new Date(now).toLocaleTimeString();
  const call = currentCall();
  if (call && call.status === "active") {
    const el = document.querySelector("[data-duration]");
    if (el) el.textContent = formatDuration(call, now);
  }
}

sideList.addEventListener("click", (event) => {
  let node = event.target;
  while (node && node !== sideList && !(node.dataset && node.dataset.sid)) node = node.parentNode;
  if (!node || node === sideList) return;
  selectedSid = node.dataset.sid;
  pinned = true;
  render();
});

function apply(frame) {
  if (frame.type === "snapshot") {
    calls.clear();
    for (const call of frame.calls || []) calls.set(call.callSid, call);
  } else if (frame.type === "call.update" && frame.call) {
    calls.set(frame.call.callSid, frame.call);
  }
  render();
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(proto + "://" + location.host + "/api/v1/stream/dashboard");
  socket.onopen = () => { conn.className = "live"; connText.textContent = "Live"; };
  socket.onclose = () => {
    conn.className = "";
    connText.textContent = "Reconnecting\u2026";
    setTimeout(connect, 1500);
  };
  socket.onerror = () => socket.close();
  socket.onmessage = (event) => {
    try { apply(JSON.parse(event.data)); } catch (_) {}
  };
}

render();
tick();
setInterval(tick, 1000);
connect();
</script>
</body>
</html>`;

export async function registerHome(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(PAGE);
  });
}
