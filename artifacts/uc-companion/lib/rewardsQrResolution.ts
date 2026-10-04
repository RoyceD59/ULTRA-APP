import type { RewardsQrInspection } from '@workspace/api-client-react/companion/models/rewardsQrInspection';

export type ResolvedRewardsQr = {
  userId: number;
  token: string | null;
  version: string | null;
  recoveryRequired: boolean;
  persistenceWarning: boolean;
};
const isToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(value);

/** Secure storage is only a candidate. Every display requires server validation.
 * This read path deliberately has no issuance/rotation callback. */
export async function resolveRewardsQrToken(
  userId: number,
  rewardsToken: string | null | undefined,
  inspect: (candidate: string | null, signal: AbortSignal) => Promise<RewardsQrInspection>,
  readLocal: (id: number) => Promise<string | null>,
  storeLocal: (id: number, token: string) => Promise<void>,
  signal: AbortSignal,
): Promise<ResolvedRewardsQr> {
  let candidate: string | null = isToken(rewardsToken) ? rewardsToken : null;
  let persistenceWarning = false;
  if (!candidate) {
    try { candidate = await storageDeadline(readLocal(userId)); }
    catch { persistenceWarning = true; }
  }
  if (signal.aborted) throw new Error('QR verification cancelled');
  if (!isToken(candidate)) candidate = null;
  const current = await inspect(candidate, signal);
  if (signal.aborted) throw new Error('QR verification cancelled');
  if (current.userId !== userId) throw new Error('QR account verification failed');
  const token = current.status === 'active'
    ? isToken(current.qrToken) ? current.qrToken : current.valid ? candidate : null
    : null;
  if (token) {
    try { await storageDeadline(storeLocal(userId, token)); }
    catch { persistenceWarning = true; }
  }
  if (signal.aborted) throw new Error('QR verification cancelled');
  return { userId, token, version: current.version, recoveryRequired: !token, persistenceWarning };
}

/** Storage bridges can hang as well as throw; neither may trap a QR loader. */
export async function storageDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Secure QR storage unavailable')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}