import { loadConfig, missingCredentials } from "./config.js";
import { createLogger } from "./logger.js";
import { startSubscriber } from "./redis/subscriber.js";
import { SentimentTracker } from "./state/sentiment-tracker.js";

const config = loadConfig();
const log = createLogger(config);

const missing = missingCredentials(config);
if (missing.length > 0) {
  log.error({ missing }, "DELIVERY_TRANSPORT=http but credentials are missing");
  process.exit(1);
}

const sentiment = new SentimentTracker();
const subscriber = startSubscriber({ config, log, sentiment });

log.info(
  {
    channel: config.redisChannel,
    transport: config.transport,
    whatsapp: config.whatsapp.provider,
    email: config.email.provider,
    maxAttempts: config.maxAttempts,
  },
  "consilium-notifications started",
);
if (config.transport === "mock") {
  log.warn("Running in MOCK transport: no messages will actually be sent");
}

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "Shutting down");
    void subscriber.close().then(() => process.exit(0));
  });
}

// A dropped promise anywhere else must be logged, not silently kill the box.
process.on("unhandledRejection", (reason) => {
  log.error({ err: reason instanceof Error ? reason.message : String(reason) }, "Unhandled rejection");
});
process.on("uncaughtException", (error) => {
  log.fatal({ err: error.message, stack: error.stack }, "Uncaught exception, exiting");
  void subscriber.close().finally(() => process.exit(1));
});
