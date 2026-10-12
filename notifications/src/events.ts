import type { Coordinates, RsaConfirmedEvent } from "./types.js";

export interface ChannelEvent {
  callSid: string;
  type: string;
  data: Record<string, unknown>;
}

export const RSA_CONFIRMED = "rsa_confirmed";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return null;
}

function firstNumber(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim() !== "") {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Parse one message off `voice_agent_events`.
 *
 * The Python voice agent writes snake_case while Twilio writes `CallSid`, so
 * both spellings are accepted. Returns null for anything unroutable.
 */
export function parseChannelEvent(raw: string): ChannelEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  const callSid = firstString(
    record.CallSID,
    record.CallSid,
    record.callSid,
    record.call_sid,
    record.SessionID,
    record.sessionId,
    record.session_id,
  );
  const type = firstString(record.type, record.event, record.Type);
  if (callSid === null || type === null) return null;

  return {
    callSid,
    type: type.toLowerCase(),
    data: asRecord(record.data ?? record),
  };
}

/**
 * Coordinates arrive either as `"28.5678,77.2431"` or as an object with some
 * spelling of latitude/longitude, depending on which handset reported them.
 */
export function parseCoordinates(value: unknown): Coordinates | null {
  if (typeof value === "string") {
    const [lat, lng] = value.split(",").map((part) => Number(part.trim()));
    if (lat === undefined || lng === undefined) return null;
    return inRange(lat, lng) ? { latitude: lat, longitude: lng } : null;
  }

  if (Array.isArray(value) && value.length >= 2) {
    const lat = firstNumber(value[0]);
    const lng = firstNumber(value[1]);
    return lat !== null && lng !== null && inRange(lat, lng)
      ? { latitude: lat, longitude: lng }
      : null;
  }

  const record = asRecord(value);
  const latitude = firstNumber(record.latitude, record.lat, record.Latitude);
  const longitude = firstNumber(
    record.longitude,
    record.lng,
    record.lon,
    record.long,
    record.Longitude,
  );
  if (latitude === null || longitude === null || !inRange(latitude, longitude)) {
    return null;
  }

  const address = firstString(record.address, record.formatted_address, record.place);
  const accuracy = firstNumber(record.accuracy, record.accuracyMeters, record.accuracy_m);

  return {
    latitude,
    longitude,
    ...(address !== null ? { address } : {}),
    ...(accuracy !== null ? { accuracyMeters: accuracy } : {}),
  };
}

function inRange(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/** Normalise to E.164, defaulting to +91 for the bare 10-digit Indian numbers. */
export function normalisePhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

export interface RsaParseFailure {
  ok: false;
  reason: string;
}

export type RsaParseResult = { ok: true; event: RsaConfirmedEvent } | RsaParseFailure;

/**
 * Pull the RSA dispatch details out of an `rsa_confirmed` payload.
 *
 * Failures are described rather than thrown: a malformed event must be logged
 * and skipped, never take the subscriber down.
 */
export function parseRsaConfirmed(event: ChannelEvent): RsaParseResult {
  const { data } = event;

  const rawCoordinates =
    data.GPS ?? data.gps ?? data.coordinates ?? data.location ?? data.Location;
  const coordinates = parseCoordinates(rawCoordinates);
  if (coordinates === null) {
    return { ok: false, reason: "missing or invalid GPS coordinates" };
  }

  const rawNumber = firstString(
    data.callerNumber,
    data.caller_number,
    data.CallerNumber,
    data.from,
    data.From,
    data.phone,
    data.phoneNumber,
  );
  // A missing number still dispatches: the manager email must go out, and
  // WhatsApp reports its own failure instead of dropping the whole event.
  const callerNumber = rawNumber === null ? "" : (normalisePhone(rawNumber) ?? "");

  const notes = firstString(data.notes, data.issue, data.description);
  const confirmedAt =
    firstString(data.confirmedAt, data.at, data.timestamp) ?? new Date().toISOString();

  return {
    ok: true,
    event: {
      callSid: event.callSid,
      callerNumber,
      coordinates,
      ...(notes !== null ? { notes } : {}),
      confirmedAt,
    },
  };
}

/** Sentiment score off a `sentiment` event, clamped to 0..100. */
export function parseSentiment(data: Record<string, unknown>): number | null {
  const score = firstNumber(data.score, data.sentiment, data.value);
  if (score === null) return null;
  return Math.min(Math.max(Math.round(score), 0), 100);
}
