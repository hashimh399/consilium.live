import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { Config } from "../config.js";
import { DeliveryError, isRetryableStatus } from "./errors.js";
import { withRetry } from "./retry.js";

/** A provider request, built the same way whether or not it is actually sent. */
export interface ProviderRequest {
  /** Short name used in logs, e.g. `whatsapp:meta`. */
  label: string;
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  /** Redacted, human-readable summary for the mock transport's log line. */
  preview: Record<string, unknown>;
  /** Pulls the provider's id out of a success response. */
  readReference: (payload: unknown) => string | null;
}

export interface DeliveryOutcome {
  reference: string;
  attempts: number;
  durationMs: number;
}

/**
 * Send a provider request, or pretend to.
 *
 * The mock path still builds the exact URL, headers and body the real
 * provider would receive, so switching `DELIVERY_TRANSPORT=http` changes
 * nothing except whether the bytes leave the process.
 */
export async function deliver(
  request: ProviderRequest,
  config: Config,
  log: Logger,
): Promise<DeliveryOutcome> {
  const startedAt = Date.now();

  const { value, attempts } = await withRetry(
    (attempt) =>
      config.transport === "mock"
        ? sendMock(request, config, log, attempt)
        : sendHttp(request, config),
    { label: request.label, attempts: config.maxAttempts, log },
  );

  return { reference: value, attempts, durationMs: Date.now() - startedAt };
}

async function sendHttp(request: ProviderRequest, config: Config): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new DeliveryError(
        `${request.label} returned ${response.status}: ${text.slice(0, 300)}`,
        { retryable: isRetryableStatus(response.status), status: response.status },
      );
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // SMTP-style providers answer with plain text; the id is optional.
    }
    return request.readReference(payload) ?? `${request.label}-${randomUUID()}`;
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DeliveryError(`${request.label} timed out after ${config.timeoutMs}ms`, {
        retryable: true,
        cause: error,
      });
    }
    // fetch only rejects on network-level problems, which are worth retrying.
    throw new DeliveryError(`${request.label} network error`, {
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendMock(
  request: ProviderRequest,
  config: Config,
  log: Logger,
  attempt: number,
): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 120));

  if (Math.random() < config.mockFailureRate) {
    throw new DeliveryError(`${request.label} mock failure (simulated 503)`, {
      retryable: true,
      status: 503,
    });
  }

  log.info(
    {
      label: request.label,
      attempt,
      url: request.url,
      transport: "mock",
      ...request.preview,
    },
    "MOCK send (set DELIVERY_TRANSPORT=http to deliver for real)",
  );

  return `mock-${request.label.replace(/\W+/g, "-")}-${randomUUID()}`;
}
