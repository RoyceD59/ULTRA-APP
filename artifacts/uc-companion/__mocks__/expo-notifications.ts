/**
 * expo-notifications stub for the Node.js test runner.
 *
 * Exported `_*` helpers let the test file inspect state and reset between tests.
 */

export const _scheduled: string[] = [];
export const _cancelled: string[] = [];
let _counter = 0;

// Push-token state — tests can rotate the token and add per-call delays to
// simulate slow OS calls.
const _pushState = {
  token: 'ExponentPushToken[test-1]',
  delayMs: 0,
  fetchCount: 0,
};
export function _setPushToken(t: string): void { _pushState.token = t; }
export function _setPushTokenDelay(ms: number): void { _pushState.delayMs = ms; }
export function _getPushTokenFetchCount(): number { return _pushState.fetchCount; }

export function _reset(): void {
  _scheduled.length = 0;
  _cancelled.length = 0;
  _counter = 0;
  _pushState.token = 'ExponentPushToken[test-1]';
  _pushState.delayMs = 0;
  _pushState.fetchCount = 0;
}

export async function getExpoPushTokenAsync(): Promise<{ data: string }> {
  _pushState.fetchCount++;
  if (_pushState.delayMs > 0) {
    await new Promise(r => setTimeout(r, _pushState.delayMs));
  }
  return { data: _pushState.token };
}

// ── Stubs used by useNotifications.ts ────────────────────────────────────────

export function setNotificationHandler(_handler: unknown): void { /* no-op */ }

export async function getPermissionsAsync() {
  return { granted: true, canAskAgain: true };
}

export async function requestPermissionsAsync() {
  return { granted: true, canAskAgain: true };
}

export async function setNotificationChannelAsync(
  _channelId: string,
  _channel: unknown,
): Promise<void> { /* no-op */ }

export async function scheduleNotificationAsync(
  _request: unknown,
): Promise<string> {
  const id = `notif-${++_counter}`;
  _scheduled.push(id);
  return id;
}

export async function cancelScheduledNotificationAsync(id: string): Promise<void> {
  _cancelled.push(id);
}

export const AndroidImportance = { DEFAULT: 3 } as const;
