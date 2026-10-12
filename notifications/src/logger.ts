import { pino, type Logger } from "pino";

import type { Config } from "./config.js";

/**
 * Phone numbers and tokens travel through these logs, so redact anything
 * that could turn a log dump into a PII leak.
 */
const REDACT_PATHS = [
  "*.authorization",
  "*.Authorization",
  "headers.authorization",
  "headers.Authorization",
  "*.accessToken",
  "*.apiKey",
  "config.meta.accessToken",
  "config.twilio.authToken",
  "config.sendgridApiKey",
];

export function createLogger(config: Config): Logger {
  return pino({
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: { service: "consilium-notifications" },
    ...(config.logPretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l" },
          },
        }
      : {}),
  });
}

/** `+919812345678` -> `+9198****5678`, enough to correlate without exposing it. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${value.slice(0, 5)}****${digits.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const [user = "", domain = ""] = value.split("@");
  if (domain === "") return "***";
  const head = user.slice(0, 2);
  return `${head}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}
