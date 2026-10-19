import type { GlobalImpactSnapshot } from '@workspace/api-client-react/companion/models/globalImpactSnapshot';
export type GlobalImpact = GlobalImpactSnapshot;

/** Public read transport: no session headers, account token, or fallback totals. */
export async function fetchGlobalImpact(apiOrigin: string, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${apiOrigin}/api/uc/impact`, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Global impact refresh failed');
    return parseGlobalImpact(await response.json());
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export function parseGlobalImpact(value: unknown): GlobalImpact {
  const data = value as GlobalImpact;
  if (!data || !["totalUsers", "litresFiltered", "plasticsAvoided", "cleanWaterDays"].every(
    key => Number.isFinite(data[key as keyof GlobalImpact]) && Number(data[key as keyof GlobalImpact]) >= 0,
  ) || typeof data.snapshotId !== "string" || !/^[a-f0-9]{64}$/.test(data.snapshotId)
    || !Number.isFinite(Date.parse(data.calculatedAt)) || data.maxAgeSeconds !== 60
    || !Number.isSafeInteger(data.adjustmentRevision) || data.adjustmentRevision < 1
    || typeof data.lifespanAvailable !== 'boolean') {
    throw new Error("Global impact snapshot could not be verified. Try again after the service is updated.");
  }
  return data;
}

export function impactFreshness(data: GlobalImpact | undefined, receivedAt: number, now: number, failed: boolean, online: boolean) {
  if (!data) return failed || !online ? "UNAVAILABLE" : "LOADING";
  if (!online || failed || !receivedAt || now - receivedAt >= 60_000) return "STALE";
  return "CURRENT";
}
