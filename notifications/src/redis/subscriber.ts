import { Redis } from "ioredis";
import type { Logger } from "pino";

import type { Config } from "../config.js";
import { describeError } from "../delivery/errors.js";
import {
  parseChannelEvent,
  parseRsaConfirmed,
  parseSentiment,
  RSA_CONFIRMED,
  type ChannelEvent,
} from "../events.js";
import { dispatchRsaNotifications } from "../notifications/dispatch.js";
import type { SentimentTracker } from "../state/sentiment-tracker.js";

export interface SubscriberDeps {
  config: Config;
  log: Logger;
  sentiment: SentimentTracker;
}

export interface Subscriber {
  close(): Promise<void>;
}

/** Calls already dispatched, so a redelivered event is not acted on twice. */
const handled = new Set<string>();

export function startSubscriber(deps: SubscriberDeps): Subscriber {
  const { config, log, sentiment } = deps;

  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt: number) => Math.min(attempt * 500, 10_000),
  });

  let reportedDown = false;

  client.on("error", (error: Error) => {
    if (reportedDown) return;
    reportedDown = true;
    log.warn(
      { err: error.message, url: config.redisUrl },
      "Redis unavailable; retrying in the background",
    );
  });

  // Subscribing on every `ready` rather than once at boot means a Redis that
  // is down at startup, or restarted later, is still picked up.
  client.on("ready", () => {
    reportedDown = false;
    client
      .subscribe(config.redisChannel)
      .then(() => log.info({ channel: config.redisChannel }, "Subscribed to voice agent events"))
      .catch((error: unknown) =>
        log.error({ err: describeError(error) }, "Subscribe failed; will retry on reconnect"),
      );
  });

  client.on("message", (channel: string, raw: string) => {
    if (channel !== config.redisChannel) return;
    // Handlers are async but Redis delivery is fire-and-forget; an unhandled
    // rejection here would take the process down, so it is contained.
    void handleMessage(raw, deps).catch((error: unknown) =>
      log.error({ err: describeError(error) }, "Event handler crashed"),
    );
  });

  void client.connect().catch(() => {
    // Already reported by the `error` handler; ioredis reconnects on its own.
  });

  const pruneTimer = setInterval(() => {
    const removed = sentiment.prune();
    if (removed > 0) log.debug({ removed, tracked: sentiment.size }, "Pruned stale sentiment");
  }, 15 * 60 * 1000);
  pruneTimer.unref();

  return {
    async close(): Promise<void> {
      clearInterval(pruneTimer);
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

async function handleMessage(raw: string, deps: SubscriberDeps): Promise<void> {
  const { log, sentiment, config } = deps;

  const event = parseChannelEvent(raw);
  if (event === null) {
    log.warn({ raw: raw.slice(0, 200) }, "Discarded unparseable event");
    return;
  }

  if (event.type === "sentiment") {
    const score = parseSentiment(event.data);
    if (score !== null) {
      sentiment.record(event.callSid, score);
      log.debug({ callSid: event.callSid, score }, "Recorded sentiment");
    }
    return;
  }

  if (event.type !== RSA_CONFIRMED) return;

  await handleRsaConfirmed(event, deps, config);
}

async function handleRsaConfirmed(
  event: ChannelEvent,
  deps: SubscriberDeps,
  config: Config,
): Promise<void> {
  const { log, sentiment } = deps;

  const parsed = parseRsaConfirmed(event);
  if (!parsed.ok) {
    log.error(
      { callSid: event.callSid, reason: parsed.reason, data: event.data },
      "Cannot dispatch RSA: malformed payload",
    );
    return;
  }

  if (handled.has(event.callSid)) {
    log.warn({ callSid: event.callSid }, "Duplicate rsa_confirmed ignored");
    return;
  }
  handled.add(event.callSid);

  const summary = await dispatchRsaNotifications(
    parsed.event,
    sentiment.get(event.callSid),
    { config, log },
  );

  // A wholly failed dispatch is worth retrying if the agent re-publishes.
  if (!summary.allDelivered) handled.delete(event.callSid);
}
