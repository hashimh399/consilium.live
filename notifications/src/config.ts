export type DeliveryTransport = "mock" | "http";
export type WhatsAppProvider = "meta" | "twilio";
export type EmailProvider = "sendgrid" | "smtp";

export interface WhatsAppConfig {
  provider: WhatsAppProvider;
  from: string;
  metaPhoneNumberId: string;
  metaAccessToken: string;
  metaGraphVersion: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
}

export interface EmailConfig {
  provider: EmailProvider;
  from: string;
  managerEmail: string;
  sendgridApiKey: string;
  smtpUrl: string;
}

export interface Config {
  logLevel: string;
  logPretty: boolean;
  redisUrl: string;
  redisChannel: string;
  /** `mock` builds the real provider request but never sends it. */
  transport: DeliveryTransport;
  mockFailureRate: number;
  maxAttempts: number;
  timeoutMs: number;
  whatsapp: WhatsAppConfig;
  email: EmailConfig;
}

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readRate(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 1);
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const candidate = (value ?? "").trim().toLowerCase() as T;
  return allowed.includes(candidate) ? candidate : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    logLevel: env.LOG_LEVEL ?? "info",
    logPretty: readBool(env.LOG_PRETTY, true),
    redisUrl: env.REDIS_URL ?? "redis://127.0.0.1:6379",
    redisChannel: env.REDIS_CHANNEL ?? "voice_agent_events",
    transport: readEnum(env.DELIVERY_TRANSPORT, ["mock", "http"] as const, "mock"),
    mockFailureRate: readRate(env.MOCK_FAILURE_RATE),
    maxAttempts: readInt(env.NOTIFY_MAX_ATTEMPTS, 3, 1, 10),
    timeoutMs: readInt(env.NOTIFY_TIMEOUT_MS, 8_000, 500, 60_000),
    whatsapp: {
      provider: readEnum(env.WHATSAPP_PROVIDER, ["meta", "twilio"] as const, "meta"),
      from: env.WHATSAPP_FROM ?? "+911141234567",
      metaPhoneNumberId: env.META_PHONE_NUMBER_ID ?? "000000000000000",
      metaAccessToken: env.META_ACCESS_TOKEN ?? "",
      metaGraphVersion: env.META_GRAPH_VERSION ?? "v21.0",
      twilioAccountSid: env.TWILIO_ACCOUNT_SID ?? "",
      twilioAuthToken: env.TWILIO_AUTH_TOKEN ?? "",
    },
    email: {
      provider: readEnum(env.EMAIL_PROVIDER, ["sendgrid", "smtp"] as const, "sendgrid"),
      from: env.EMAIL_FROM ?? "alerts@consilium.live",
      managerEmail: env.MANAGER_EMAIL ?? "manager@consilium.live",
      sendgridApiKey: env.SENDGRID_API_KEY ?? "",
      smtpUrl: env.SMTP_URL ?? "smtp://127.0.0.1:1025",
    },
  };
}

/**
 * Credentials the chosen transport needs but does not have. Reported at boot
 * so a misconfigured deploy is obvious before the first real RSA call.
 */
export function missingCredentials(config: Config): string[] {
  if (config.transport === "mock") return [];

  const missing: string[] = [];
  if (config.whatsapp.provider === "meta") {
    if (config.whatsapp.metaAccessToken === "") missing.push("META_ACCESS_TOKEN");
  } else if (config.whatsapp.twilioAccountSid === "") {
    missing.push("TWILIO_ACCOUNT_SID");
  } else if (config.whatsapp.twilioAuthToken === "") {
    missing.push("TWILIO_AUTH_TOKEN");
  }
  if (config.email.provider === "sendgrid" && config.email.sendgridApiKey === "") {
    missing.push("SENDGRID_API_KEY");
  }
  return missing;
}
