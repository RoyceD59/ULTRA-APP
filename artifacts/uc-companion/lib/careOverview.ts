import { refillCapabilitiesSchema } from '@workspace/api-zod/refill-readiness';

/** Both switches must opt in. Offline, old servers and malformed data hide it. */
export function careOverviewAvailable(value: unknown, clientFlag?: string): boolean {
  if (clientFlag?.trim().toLowerCase() !== 'true') return false;
  const parsed = refillCapabilitiesSchema.safeParse(value);
  return parsed.success && parsed.data.careOverview;
}
