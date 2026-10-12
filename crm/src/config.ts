export interface Config {
  host: string;
  port: number;
  logLevel: string;
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
    port: readPort(env.PORT, 8080),
    logLevel: env.LOG_LEVEL ?? "info",
  };
}
