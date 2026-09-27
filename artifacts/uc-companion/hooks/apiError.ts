/**
 * Structured error thrown by the useApi fetch helpers on non-2xx responses.
 *
 * Pure, dependency-free module (no react-native imports) so it can be unit
 * tested under node:test and re-exported by hooks/useApi.ts for app code.
 *
 * Callers can inspect `retryable` to decide whether to offer a retry path:
 *   - `retryable: true`  → server-side blip (5xx); safe to retry
 *   - `retryable: false` → permanent failure (declined card, bad input, etc.)
 * and `rateLimited` to detect a 429, which must NEVER offer an immediate
 * retry button (that would let the user bypass the rate limit by tapping).
 */
export class ApiError extends Error {
  /** HTTP status code */
  status: number;
  /** True when the server signals the failure is transient (e.g. 5xx outage) */
  retryable: boolean;
  /** Raw parsed response body */
  body: Record<string, unknown>;

  /** True when the server returned 429 — caller should prompt the user to wait */
  rateLimited: boolean;

  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.rateLimited = status === 429;
    // Explicit server flag wins; fall back to treating any 5xx as retryable so a
    // server that forgets to include the flag still produces the right behaviour.
    // Rate-limited requests are not retryable — the user must wait.
    this.retryable = !this.rateLimited && (body['retryable'] === true || status >= 500);
    this.body = body;
  }
}
