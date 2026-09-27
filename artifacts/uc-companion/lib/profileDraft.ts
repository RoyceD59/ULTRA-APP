import AsyncStorage from '@react-native-async-storage/async-storage';

export const PROFILE_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const PROFILE_SESSION_EXPIRED_MESSAGE =
  'Your session expired. Sign in again to finish saving these changes.';
export const PROFILE_SIGN_IN_AGAIN_LABEL = 'Sign in again';

const PROFILE_DRAFT_KEY = 'uc_profile_draft';
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(write: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(write, write);
  writeQueue = next.catch(() => {});
  return next;
}

export interface ProfileDraftFields {
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
}

export interface OwnedProfileDraft {
  accountId: number;
  fields: ProfileDraftFields;
}

interface StoredProfileDraft {
  accountId: number;
  updatedAt: number;
  fields: ProfileDraftFields;
}

function isProfileDraftFields(value: unknown): value is ProfileDraftFields {
  if (!value || typeof value !== 'object') return false;
  const fields = value as Record<string, unknown>;
  return (
    typeof fields.firstName === 'string'
    && typeof fields.lastName === 'string'
    && typeof fields.phone === 'string'
    && typeof fields.address === 'string'
  );
}

function isStoredProfileDraft(value: unknown): value is StoredProfileDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.accountId === 'number'
    && Number.isFinite(draft.accountId)
    && typeof draft.updatedAt === 'number'
    && Number.isFinite(draft.updatedAt)
    && isProfileDraftFields(draft.fields)
  );
}

export async function saveProfileDraft(
  accountId: number,
  fields: ProfileDraftFields,
  now = Date.now(),
): Promise<void> {
  const draft: StoredProfileDraft = { accountId, updatedAt: now, fields };
  await enqueueWrite(() => AsyncStorage.setItem(PROFILE_DRAFT_KEY, JSON.stringify(draft)));
}

export async function loadProfileDraft(
  accountId: number,
  now = Date.now(),
): Promise<ProfileDraftFields | null> {
  await writeQueue;
  const raw = await AsyncStorage.getItem(PROFILE_DRAFT_KEY);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await clearProfileDraft();
    return null;
  }

  if (
    !isStoredProfileDraft(parsed)
    || parsed.updatedAt > now
    || now - parsed.updatedAt > PROFILE_DRAFT_RETENTION_MS
  ) {
    await clearProfileDraft();
    return null;
  }

  if (parsed.accountId !== accountId) return null;
  return parsed.fields;
}

export async function loadOwnedProfileDraftSafely(accountId: number): Promise<OwnedProfileDraft | null> {
  try {
    const fields = await loadProfileDraft(accountId);
    return fields ? { accountId, fields } : null;
  } catch {
    return null;
  }
}

export function shouldApplyLoadedProfileDraft(
  requestedAccountId: number,
  activeAccountId: number | null,
): boolean {
  return requestedAccountId === activeAccountId;
}

export function profileDraftForAccount(
  owned: OwnedProfileDraft | null,
  accountId: number,
): ProfileDraftFields | null {
  return owned?.accountId === accountId ? owned.fields : null;
}

export async function clearProfileDraft(): Promise<void> {
  await enqueueWrite(() => AsyncStorage.removeItem(PROFILE_DRAFT_KEY));
}

export function isExpiredProfileSession(error: unknown): error is { status: number } {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  const candidate = error as { status?: unknown; body?: unknown };
  if (candidate.status === 401) return true;
  if (candidate.status !== 403 || !candidate.body || typeof candidate.body !== 'object') return false;
  return (candidate.body as Record<string, unknown>)['code'] === 'SESSION_EXPIRED';
}

export async function preserveProfileDraftAfterSaveError(
  accountId: number,
  fields: ProfileDraftFields,
  error: unknown,
): Promise<boolean> {
  if (!isExpiredProfileSession(error)) return false;
  await saveProfileDraft(accountId, fields);
  return true;
}