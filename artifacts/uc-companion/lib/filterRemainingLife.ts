/** Display-only: no storage, notification, or mutation dependencies. */
export interface LifeCycle {
  productId: number;
  activatedAt: string;
  sourceOrderId?: number;
  registeredFilterId?: number;
}
export interface CapacityCycle {
  id: number;
  userId?: number;
  productId: number;
  activatedAt: string;
  sourceOrderId: number | null;
  ratedCapacityLitres: number;
  usedLitres: number;
  verificationStatus?: string;
  capacityUsageValid?: boolean;
}
const DAY = 86_400_000;
const clamp = (n: number) => Math.max(0, Math.min(100, n));
function cycleTime(value: string): number {
  // Date.parse normalizes impossible dates such as February 30; reject them.
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
  if (!match) return NaN;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day) return NaN;
  return Date.parse(value);
}

/** Even an explicit ID must agree with the purchase and activation cycle.
 * Legacy links require a unique exact purchase/date match, never product alone.
 */
export function resolveCapacityCycle(
  activation: LifeCycle, filters: CapacityCycle[] | undefined, customerId: number | undefined,
): CapacityCycle | null {
  const start = cycleTime(activation.activatedAt);
  if (!customerId || !Number.isFinite(start) || !activation.sourceOrderId) return null;
  const matches = (filters ?? []).filter(f =>
    f.userId === customerId && f.verificationStatus === 'approved' &&
    f.productId === activation.productId && f.sourceOrderId === activation.sourceOrderId &&
    cycleTime(f.activatedAt) === start);
  // Check ambiguity before applying the ID, including app/store order collisions.
  if (matches.length !== 1) return null;
  const match = matches[0];
  return match.capacityUsageValid !== true ||
    (activation.registeredFilterId !== undefined && match.id !== activation.registeredFilterId)
    ? null : match;
}

export function calculateRemainingLife(
  activation: LifeCycle & { lifespanDays: number },
  effectiveDays: number,
  capacity: CapacityCycle | null,
  now: number,
) {
  const start = cycleTime(activation.activatedAt);
  const validStart = Number.isFinite(now) && Number.isFinite(start) && start <= now;
  const timeValid = validStart && Number.isFinite(activation.lifespanDays) && activation.lifespanDays > 0 &&
    Number.isFinite(effectiveDays) && effectiveDays > 0;
  const remainingDays = timeValid ? Math.max(0, effectiveDays - (now - start) / DAY) : null;
  const timePercent = remainingDays === null ? null : clamp(remainingDays / effectiveDays * 100);
  // A future activation cannot justify capacity usage for that cycle either.
  const capacityValid = validStart && capacity !== null &&
    Number.isFinite(capacity.ratedCapacityLitres) && capacity.ratedCapacityLitres > 0 &&
    Number.isFinite(capacity.usedLitres) && capacity.usedLitres >= 0;
  const remainingLitres = capacityValid ? Math.max(0, capacity!.ratedCapacityLitres - capacity!.usedLitres) : null;
  const capacityPercent = remainingLitres === null ? null : clamp(remainingLitres / capacity!.ratedCapacityLitres * 100);
  const percent = timePercent === null ? capacityPercent : capacityPercent === null
    ? timePercent : Math.min(timePercent, capacityPercent);
  const status = percent === null ? 'unavailable' : percent >= 70 ? 'green' : percent >= 40 ? 'amber' : 'red';
  const description = status === 'unavailable' ? 'Status unavailable' : percent === 0 ? 'Replacement due'
    : status === 'green' ? 'Life remaining' : status === 'amber' ? 'Plan replacement' : 'Replace soon';
  const basis = timePercent !== null && capacityPercent !== null ? 'Time and recorded litres · lower remaining life'
    : timePercent !== null ? 'Time-based status' : capacityPercent !== null ? 'Recorded litres only · time unavailable' : 'No valid lifespan data';
  return { percent, status, description, basis, remainingDays, remainingLitres, timePercent, capacityPercent };
}