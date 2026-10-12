import type {
  ActiveCall,
  CallerProfile,
  CallStatus,
  TranscriptEntry,
  TranscriptRole,
} from "../types.js";

const NEUTRAL_SENTIMENT = 50;
const MAX_STEP_TRAIL = 8;

function clampSentiment(value: number): number {
  if (!Number.isFinite(value)) return NEUTRAL_SENTIMENT;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * In-memory registry of calls, keyed by CallSID.
 *
 * Completed calls are kept so the dashboard can still show the final
 * transcript; `prune` drops them once they are old enough.
 */
export class CallStore {
  private readonly calls = new Map<string, ActiveCall>();

  list(): ActiveCall[] {
    return [...this.calls.values()].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  get(callSid: string): ActiveCall | undefined {
    return this.calls.get(callSid);
  }

  size(): number {
    return this.calls.size;
  }

  /** Return the call, creating an empty active one on first sight. */
  ensure(callSid: string): ActiveCall {
    const existing = this.calls.get(callSid);
    if (existing) return existing;

    const now = new Date().toISOString();
    const created: ActiveCall = {
      callSid,
      status: "active",
      transcript: [],
      sentiment: NEUTRAL_SENTIMENT,
      lastIntent: null,
      profile: null,
      speakingStep: null,
      voiceProfileUsed: null,
      speakingTurn: null,
      speakingIntent: null,
      stepTrail: [],
      startedAt: now,
      updatedAt: now,
    };
    this.calls.set(callSid, created);
    return created;
  }

  appendTranscript(
    callSid: string,
    text: string,
    role: TranscriptRole = "customer",
    at?: string,
  ): ActiveCall {
    const call = this.ensure(callSid);
    const entry: TranscriptEntry = {
      role,
      text,
      at: at ?? new Date().toISOString(),
    };
    call.transcript.push(entry);
    return this.touch(call);
  }

  setSentiment(callSid: string, score: number): ActiveCall {
    const call = this.ensure(callSid);
    call.sentiment = clampSentiment(score);
    return this.touch(call);
  }

  setIntent(callSid: string, intent: string): ActiveCall {
    const call = this.ensure(callSid);
    call.lastIntent = intent;
    return this.touch(call);
  }

  setStatus(callSid: string, status: CallStatus): ActiveCall {
    const call = this.ensure(callSid);
    call.status = status;
    return this.touch(call);
  }

  setSpeakingState(
    callSid: string,
    step: string,
    voiceProfile: string,
    turn: number | null = null,
    intent: string | null = null,
  ): ActiveCall {
    const call = this.ensure(callSid);
    call.speakingStep = step;
    call.voiceProfileUsed = voiceProfile;
    call.speakingTurn = turn;
    call.speakingIntent = intent;
    // A repeat of the same step, voice, and turn is one visible change.
    const last = call.stepTrail[call.stepTrail.length - 1];
    if (
      last === undefined ||
      last.step !== step ||
      last.voiceProfile !== voiceProfile ||
      last.turn !== turn
    ) {
      call.stepTrail.push({
        step,
        voiceProfile,
        turn,
        intent,
        at: new Date().toISOString(),
      });
      if (call.stepTrail.length > MAX_STEP_TRAIL) call.stepTrail.shift();
    }
    return this.touch(call);
  }

  setProfile(callSid: string, profile: CallerProfile): ActiveCall {
    const call = this.ensure(callSid);
    call.profile = profile;
    return this.touch(call);
  }

  /** Drop completed calls that have not changed for `maxAgeMs`. */
  prune(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [callSid, call] of this.calls) {
      if (call.status !== "completed") continue;
      if (Date.parse(call.updatedAt) > cutoff) continue;
      this.calls.delete(callSid);
      removed += 1;
    }
    return removed;
  }

  private touch(call: ActiveCall): ActiveCall {
    call.updatedAt = new Date().toISOString();
    return call;
  }
}
