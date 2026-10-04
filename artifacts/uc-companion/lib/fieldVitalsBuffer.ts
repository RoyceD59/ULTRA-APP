import { sanitizeVitalPayload } from './fieldVitalsPolicy';
import type { VitalPayload } from './fieldVitalsPolicy';

type Reading = { id: string; name: string; value: number };
type Dimensions = Omit<VitalPayload, 'metric' | 'value'>;

/** Keep only scalars, not PerformanceEntry objects or DOM attribution. */
export function createVitalBuffer(dimensions: Dimensions, send: (payload: VitalPayload) => void) {
  const pending = new Map<string, VitalPayload>();
  const sent = new Set<string>();
  return {
    report(reading: Reading) {
      const key = `${reading.name}:${reading.id}`;
      if (sent.has(key)) return;
      const payload = sanitizeVitalPayload({ ...dimensions, metric: reading.name, value: reading.value });
      if (payload) pending.set(key, payload);
    },
    flush() {
      for (const [key, payload] of pending) {
        sent.add(key);
        try { send(payload); } catch { /* No replay or customer-visible failures. */ }
      }
      pending.clear();
    },
  };
}