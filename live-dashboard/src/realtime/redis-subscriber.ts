import { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";

import type { Config } from "../config.js";
import type { CallStore } from "../store/call-store.js";
import { parseVoiceAgentEvent } from "../types.js";
import { applyEvent } from "./apply-event.js";
import type { DashboardHub } from "./hub.js";

export interface RedisSubscriber {
  close(): Promise<void>;
}

export interface SubscriberDeps {
  config: Config;
  store: CallStore;
  hub: DashboardHub;
  log: FastifyBaseLogger;
}

/**
 * Subscribe to the voice-agent channel and fan every event out to the
 * dashboards.
 *
 * Redis being unavailable is not fatal: ioredis keeps retrying in the
 * background so the HTTP and WebSocket surface stays up either way.
 */
export function startRedisSubscriber(deps: SubscriberDeps): RedisSubscriber {
  const { config, store, hub, log } = deps;

  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    // A subscriber has no request queue to drain, so retry forever.
    maxRetriesPerRequest: null,
    retryStrategy: (attempt: number) => Math.min(attempt * 500, 10_000),
  });

  let reportedDown = false;

  client.on("error", (error: Error) => {
    if (reportedDown) return;
    reportedDown = true;
    log.warn(
      { err: error, url: config.redisUrl },
      "Redis unavailable; dashboard will serve cached calls until it returns",
    );
  });

  // Subscribing on every `ready` rather than once at boot means a Redis that
  // is down at startup, or restarted later, still gets picked up.
  client.on("ready", () => {
    reportedDown = false;
    client
      .subscribe(config.redisChannel)
      .then(() => {
        log.info(
          { channel: config.redisChannel },
          "Subscribed to voice agent events",
        );
      })
      .catch((error: unknown) => {
        log.warn({ err: error }, "Redis subscribe failed; will retry on reconnect");
      });
  });

  client.on("message", (channel: string, raw: string) => {
    if (channel !== config.redisChannel) return;

    const event = parseVoiceAgentEvent(raw);
    if (event === null) {
      log.warn({ raw: raw.slice(0, 200) }, "Discarded malformed voice agent event");
      return;
    }

    const call = applyEvent(store, event);
    if (call === null) {
      log.debug({ event }, "Event carried no usable data");
      return;
    }

    hub.broadcastCall(call);
    log.debug(
      { callSid: call.callSid, type: event.type, clients: hub.size },
      "Broadcast call update",
    );
  });

  void client.connect().catch(() => {
    // The `error` handler already reported it; ioredis retries on its own.
  });

  return {
    async close(): Promise<void> {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}
