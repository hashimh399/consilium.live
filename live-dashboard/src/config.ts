export interface Config {
  host: string;
  port: number;
  logLevel: string;
  /** `true` reflects any origin; an array restricts to those origins. */
  corsOrigin: true | string[];
  redisUrl: string;
  redisChannel: string;
}

function readOrigin(value: string | undefined): true | string[] {
  const raw = (value ?? "http://localhost:3000").trim();
  if (raw === "*") return true;
  const origins = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return origins.length > 0 ? origins : true;
}

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: readPort(env.PORT, 4000),
    logLevel: env.LOG_LEVEL ?? "info",
    corsOrigin: readOrigin(env.CORS_ORIGIN),
    redisUrl: env.REDIS_URL ?? "redis://127.0.0.1:6379",
    redisChannel: env.REDIS_CHANNEL ?? "voice_agent_events",
  };
}
