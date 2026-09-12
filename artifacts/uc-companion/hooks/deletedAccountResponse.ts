export const DELETED_ACCOUNT_ERROR = 'This account has been deleted';

type DeletedAccountHandler = () => Promise<void>;

let deletedAccountHandler: DeletedAccountHandler | null = null;

export function isDeletedAccountResponse(
  status: number,
  body: Record<string, unknown>,
): boolean {
  return status === 401 && body['error'] === DELETED_ACCOUNT_ERROR;
}

export function setDeletedAccountHandler(handler: DeletedAccountHandler): () => void {
  deletedAccountHandler = handler;
  return () => {
    if (deletedAccountHandler === handler) deletedAccountHandler = null;
  };
}

export async function handleDeletedAccountResponse(
  status: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  if (!isDeletedAccountResponse(status, body)) return false;
  await deletedAccountHandler?.();
  return true;
}