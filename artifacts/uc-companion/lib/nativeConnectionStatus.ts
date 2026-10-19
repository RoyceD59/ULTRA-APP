/** Display-only snapshot, fed by the existing native recovery subscription.
 * Unknown reachability preserves the last confirmed state. */
let online: boolean | undefined;
const listeners = new Set<() => void>();

export function getNativeConnectionStatus() { return online; }

export function subscribeNativeConnectionStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishNativeConnectionStatus(value: boolean | undefined) {
  if (online === value) return;
  online = value;
  listeners.forEach(listener => listener());
}