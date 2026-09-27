export const DELETED_ACCOUNT_ERROR = 'This account has been deleted';

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
): rejectedToken is string {
  return status === 401 && rejectedToken !== null;
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
): Promise<boolean> {
  if (!isRejectedSessionResponse(status, rejectedToken)) return false;
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