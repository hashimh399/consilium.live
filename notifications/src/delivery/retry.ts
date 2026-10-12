import type { Logger } from "pino";

import { DeliveryError, describeError } from "./errors.js";

export interface RetryOptions {
  label: string;
  attempts: number;
  log: Logger;
  baseDelayMs?: number;
}

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run an external call with exponential backoff and full jitter.
 *
 * Every attempt is logged: for an outbound RSA notification, knowing that the
 * first two tries failed is as operationally useful as the final result.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  const { label, attempts, log, baseDelayMs = 300 } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const value = await operation(attempt);
      log.debug({ label, attempt, durationMs: Date.now() - startedAt }, "External call succeeded");
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof DeliveryError) || error.retryable;
      const status = error instanceof DeliveryError ? error.status : undefined;
      const isLast = attempt === attempts;

      log.warn(
        {
          label,
          attempt,
          maxAttempts: attempts,
          status,
          retryable,
          durationMs: Date.now() - startedAt,
          err: describeError(error),
        },
        isLast || !retryable ? "External call failed" : "External call failed, retrying",
      );

      if (!retryable || isLast) break;

      const ceiling = baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.random() * ceiling);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new DeliveryError(describeError(lastError), { retryable: false });
}
