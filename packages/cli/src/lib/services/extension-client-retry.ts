// Retry helpers for the extension HTTP client.
//
// Why: when the Directus pressure limiter (@directus/pressure) trips, it short-
// circuits the next request with a 503 before any extension/router runs.
// directus-sync used to surface this as a fatal error in cleanUp(), which sits
// outside the --max-push-retries loop, so the whole push aborted. Retrying
// transient 5xx (and transport errors) lets the CLI ride out a brief overload.

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

export interface RetryConfig {
  max: number;
  baseMs: number;
}

export function getRetryConfig(): RetryConfig {
  const rawMax = process.env.DIRECTUS_SYNC_EXTENSION_RETRY_MAX;
  const rawBase = process.env.DIRECTUS_SYNC_EXTENSION_RETRY_BASE_MS;
  const parsedMax = rawMax !== undefined ? parseInt(rawMax, 10) : NaN;
  const parsedBase = rawBase !== undefined ? parseInt(rawBase, 10) : NaN;
  return {
    max: Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : 3,
    baseMs: Number.isFinite(parsedBase) && parsedBase >= 0 ? parsedBase : 2000,
  };
}

export function isRetryableStatus(status: number, method: string): boolean {
  if (!RETRYABLE_STATUSES.has(status)) return false;
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

// Network errors thrown by fetch (TypeError) mean the request never received a
// response. Safe to retry for any HTTP method, including non-idempotent ones,
// because the server cannot have applied a partial change without responding.
export function isRetryableTransportError(err: unknown): boolean {
  return err instanceof TypeError;
}

export async function sleepWithJitter(
  baseMs: number,
  attempt: number,
): Promise<void> {
  const expBackoff = baseMs * Math.pow(2, attempt - 1);
  const jitter = expBackoff * (0.75 + Math.random() * 0.5);
  await new Promise((resolve) => setTimeout(resolve, jitter));
}
