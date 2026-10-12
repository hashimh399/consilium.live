/**
 * A failed attempt against an external provider.
 *
 * `retryable` distinguishes "the network blinked" from "this payload will
 * never be accepted", so retries are not wasted on a 400.
 */
export class DeliveryError extends Error {
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(message: string, options: { retryable: boolean; status?: number; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DeliveryError";
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

/** 408/429 and 5xx are worth another attempt; other 4xx are caller error. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
