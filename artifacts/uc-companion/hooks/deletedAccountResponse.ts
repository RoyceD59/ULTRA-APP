export const DELETED_ACCOUNT_ERROR = 'This account has been deleted';
export const PASSWORD_RESET_SESSION_ERROR = 'Session expired. Please sign in again.';

type RejectedSessionHandler = (rejectedToken: string) => Promise<void>;

let rejectedSessionHandler: RejectedSessionHandler | null = null;

export function isDeletedAccountResponse(
  status: number,
  body: Record<string, unknown>,
): boolean {
  return status === 401 && body['error'] === DELETED_ACCOUNT_ERROR;
}

export function isRejectedSessionResponse(
  status: number,
  rejectedToken: string | null,
  body: unknown,
): rejectedToken is string {
  if (status !== 401 || !rejectedToken || !body || typeof body !== 'object') return false;
  const error = (body as Record<string, unknown>)['error'];
  return error === DELETED_ACCOUNT_ERROR || error === PASSWORD_RESET_SESSION_ERROR;
}

/** Preserve the existing single retry except for API-forced sign-outs. */
export function retrySessionRequest(failureCount: number, error: unknown): boolean {
  const failure = error as { status?: number; body?: unknown; data?: unknown } | null;
  return !isRejectedSessionResponse(failure?.status ?? 0, 'authenticated', failure?.body ?? failure?.data)
    && failureCount < 1;
}

export function setRejectedSessionHandler(handler: RejectedSessionHandler): () => void {
  rejectedSessionHandler = handler;
  return () => {
    if (rejectedSessionHandler === handler) rejectedSessionHandler = null;
  };
}

/** Backward-compatible registration name for the original deleted-account contract. */
export const setDeletedAccountHandler = setRejectedSessionHandler;

export async function handleRejectedSessionResponse(
  status: number,
  rejectedToken: string | null,
  body: unknown,
): Promise<boolean> {
  if (!isRejectedSessionResponse(status, rejectedToken, body)) return false;
  await rejectedSessionHandler?.(rejectedToken);
  return true;
}

export async function handleDeletedAccountResponse(
  status: number,
  body: Record<string, unknown>,
  rejectedToken = '',
): Promise<boolean> {
  if (!isDeletedAccountResponse(status, body)) return false;
  await rejectedSessionHandler?.(rejectedToken);
  return true;
}