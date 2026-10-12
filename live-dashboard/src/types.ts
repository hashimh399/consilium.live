export type CallStatus = "active" | "completed";

export type TranscriptRole = "customer" | "assistant";

export interface TranscriptEntry {
  role: TranscriptRole;
  text: string;
  at: string;
}

/** Directory record attached by a `profile_enriched` event. */
export interface CallerProfile {
  name: string | null;
  vipStatus: string | null;
  vehicle: string | null;
  vehicleOwned: string | null;
  ownershipType: string | null;
  vinLast4: string | null;
  preferredDealer: string | null;
  lastServiceDate: string | null;
  lastServicePackage: string | null;
  nextService: string | null;
  interestNotes: string | null;
  lastSentimentRecorded: string | null;
  /** CRM `source` string, or "(No CRM Match)" when the lookup did not hit. */
  source: string | null;
}

/** One `agent_speaking_state` event, kept so the HUD can show the steps in order. */
export interface StepEntry {
  step: string;
  voiceProfile: string;
  turn: number | null;
  intent: string | null;
  at: string;
}

/** Everything the dashboard knows about one call. */
export interface ActiveCall {
  callSid: string;
  status: CallStatus;
  transcript: TranscriptEntry[];
  /** 0 = very negative, 50 = neutral, 100 = very positive. */
  sentiment: number;
  lastIntent: string | null;
  profile: CallerProfile | null;
  /** Dialogue step published with `agent_speaking_state`. */
  speakingStep: string | null;
  /** TTS persona label published as `voice_profile_used`. */
  voiceProfileUsed: string | null;
  /** Turn number and dialogue intent from the latest state event. */
  speakingTurn: number | null;
  speakingIntent: string | null;
  /** Most recent step changes, oldest first. */
  stepTrail: StepEntry[];
  startedAt: string;
  updatedAt: string;
}

export type VoiceAgentEventType =
  | "transcription"
  | "sentiment"
  | "intent"
  | "status"
  | "profile_enriched"
  | "agent_speaking_state";

export interface VoiceAgentEvent {
  callSid: string;
  type: VoiceAgentEventType;
  data: unknown;
}

/** Frames pushed down the dashboard WebSocket. */
export type DashboardMessage =
  | { type: "snapshot"; calls: ActiveCall[]; at: string }
  | { type: "call.update"; call: ActiveCall; at: string };

const EVENT_TYPES: readonly VoiceAgentEventType[] = [
  "transcription",
  "sentiment",
  "intent",
  "status",
  "profile_enriched",
  "agent_speaking_state",
];

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Parse one `voice_agent_events` payload.
 *
 * The Python voice agent emits snake_case (`call_sid`) while Twilio uses
 * `CallSid`, so both spellings are accepted. Returns null for anything that
 * cannot be routed to a call.
 */
export function parseVoiceAgentEvent(raw: string): VoiceAgentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const callSid = firstString(
    record.CallSID,
    record.CallSid,
    record.callSid,
    record.call_sid,
    record.SessionID,
    record.sessionId,
    record.session_id,
  );
  if (callSid === null) return null;

  const rawType = firstString(record.type, record.event, record.Type);
  if (rawType === null) return null;

  // The voice agent publishes lifecycle as `call_status`; the store uses `status`.
  const normalized = rawType.toLowerCase() === "call_status" ? "status" : rawType.toLowerCase();
  const type = normalized as VoiceAgentEventType;
  if (!EVENT_TYPES.includes(type)) return null;

  return { callSid, type, data: record.data ?? record };
}
