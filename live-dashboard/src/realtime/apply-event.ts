import type { CallStore } from "../store/call-store.js";
import type {
  ActiveCall,
  CallerProfile,
  CallStatus,
  TranscriptRole,
  VoiceAgentEvent,
} from "../types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readText(data: unknown): string | null {
  if (typeof data === "string") return data.trim() || null;
  const record = asRecord(data);
  for (const key of ["text", "transcript", "content", "utterance"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function readRole(data: unknown): TranscriptRole {
  const record = asRecord(data);
  const raw = record.role ?? record.speaker ?? record.source;
  if (typeof raw !== "string") return "customer";
  const role = raw.toLowerCase();
  return role === "assistant" || role === "agent" || role === "ai"
    ? "assistant"
    : "customer";
}

function readScore(data: unknown): number | null {
  if (typeof data === "number") return data;
  const record = asRecord(data);
  for (const key of ["score", "sentiment", "value"]) {
    const value = record[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readIntent(data: unknown): string | null {
  if (typeof data === "string") return data.trim() || null;
  const value = asRecord(data).intent;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readStatus(data: unknown): CallStatus | null {
  const raw = typeof data === "string" ? data : asRecord(data).status;
  if (typeof raw !== "string") return null;
  const status = raw.toLowerCase();
  if (status === "completed" || status === "ended" || status === "done") {
    return "completed";
  }
  return status === "active" || status === "in-progress" ? "active" : null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function readProfile(data: unknown): CallerProfile | null {
  const envelope = asRecord(data);
  const source = asRecord(envelope.profile ?? envelope.data ?? envelope);
  const vehicleOwned = readString(source, ["vehicle_owned", "vehicleOwned"]);
  const vehicle = readString(source, ["vehicle", "Vehicle"]);
  const profile: CallerProfile = {
    name: readString(source, ["name", "Name"]),
    vipStatus: readString(source, ["vip_status", "vipStatus", "vip"]),
    vehicle,
    vehicleOwned: vehicleOwned ?? vehicle,
    ownershipType: readString(source, ["ownership_type", "ownershipType"]),
    vinLast4: readString(source, ["vin_last_4", "vinLast4"]),
    preferredDealer: readString(source, ["preferred_dealer", "preferredDealer"]),
    lastServiceDate: readString(source, ["last_service_date", "lastServiceDate"]),
    lastServicePackage: readString(source, [
      "last_service_package",
      "lastServicePackage",
    ]),
    nextService: readString(source, ["next_service", "nextService"]),
    interestNotes: readString(source, ["interest_notes", "interestNotes"]),
    lastSentimentRecorded: readString(source, [
      "last_sentiment_recorded",
      "lastSentimentRecorded",
    ]),
    source:
      readString(envelope, ["source", "crm_source", "crmSource"]) ??
      readString(source, ["source", "crm_source", "crmSource"]),
  };
  const present = Object.values(profile).some((value) => value !== null);
  return present ? profile : null;
}

function readAt(data: unknown): string | undefined {
  const raw = asRecord(data).at ?? asRecord(data).timestamp;
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
}

/**
 * Fold one voice-agent event into the store.
 *
 * Returns the updated call, or null when the payload carried nothing usable
 * so the caller can skip the broadcast.
 */
export function applyEvent(
  store: CallStore,
  event: VoiceAgentEvent,
): ActiveCall | null {
  const { callSid, type, data } = event;

  switch (type) {
    case "transcription": {
      const text = readText(data);
      if (text === null) return null;
      const call = store.appendTranscript(
        callSid,
        text,
        readRole(data),
        readAt(data),
      );
      // Transcription payloads often piggyback the freshly classified intent.
      const intent = readIntent(asRecord(data).intent);
      return intent === null ? call : store.setIntent(callSid, intent);
    }

    case "sentiment": {
      const score = readScore(data);
      const intent = readIntent(asRecord(data).intent);
      if (score === null && intent === null) return null;
      let call = store.ensure(callSid);
      if (score !== null) call = store.setSentiment(callSid, score);
      if (intent !== null) call = store.setIntent(callSid, intent);
      return call;
    }

    case "intent": {
      const intent = readIntent(data);
      return intent === null ? null : store.setIntent(callSid, intent);
    }

    case "status": {
      const status = readStatus(data);
      return status === null ? null : store.setStatus(callSid, status);
    }

    case "profile_enriched": {
      const profile = readProfile(data);
      return profile === null ? null : store.setProfile(callSid, profile);
    }

    case "agent_speaking_state": {
      const record = asRecord(data);
      const step = readString(record, ["current_step", "currentStep"]);
      const voice = readString(record, ["voice_profile_used", "voiceProfileUsed"]);
      if (step === null || voice === null) return null;
      const rawTurn = record.turn;
      const turn =
        typeof rawTurn === "number" && Number.isFinite(rawTurn)
          ? rawTurn
          : typeof rawTurn === "string" && Number.isFinite(Number(rawTurn))
            ? Number(rawTurn)
            : null;
      return store.setSpeakingState(
        callSid,
        step,
        voice,
        turn,
        readString(record, ["intent"]),
      );
    }

    default:
      return null;
  }
}
