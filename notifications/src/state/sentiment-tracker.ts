interface Entry {
  score: number;
  at: number;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Remembers the most recent sentiment score per call.
 *
 * `rsa_confirmed` payloads carry the location and the caller, not the mood of
 * the conversation, so the score is picked up from the `sentiment` events
 * flowing down the same channel and replayed into the manager alert.
 */
export class SentimentTracker {
  private readonly scores = new Map<string, Entry>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  get size(): number {
    return this.scores.size;
  }

  record(callSid: string, score: number): void {
    this.scores.set(callSid, { score, at: Date.now() });
  }

  /** Last known score, or null if the call was never scored. */
  get(callSid: string): number | null {
    const entry = this.scores.get(callSid);
    if (entry === undefined) return null;
    if (Date.now() - entry.at > this.ttlMs) {
      this.scores.delete(callSid);
      return null;
    }
    return entry.score;
  }

  forget(callSid: string): void {
    this.scores.delete(callSid);
  }

  /** Drop expired entries so a long-running process does not grow forever. */
  prune(): number {
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    for (const [callSid, entry] of this.scores) {
      if (entry.at < cutoff) {
        this.scores.delete(callSid);
        removed += 1;
      }
    }
    return removed;
  }
}
