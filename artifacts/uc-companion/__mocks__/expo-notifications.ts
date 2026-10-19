/**
 * expo-notifications stub for the Node.js test runner.
 *
 * Exported `_*` helpers let the test file inspect state and reset between tests.
 */

export const _scheduled: string[] = [];
export const _cancelled: string[] = [];
/** Full scheduling requests ({ id, content, trigger }) for timing assertions. */
export const _requests: Array<{ id: string; content: unknown; trigger: unknown }> = [];
let _counter = 0;

// Push-token state — tests can rotate the token and add per-call delays to
// simulate slow OS calls.
const _pushState = {
  token: 'ExponentPushToken[test-1]',
  delayMs: 0,
  fetchCount: 0,
  permissionRequestCount: 0,
};
export function _setPushToken(t: string): void { _pushState.token = t; }
export function _setPushTokenDelay(ms: number): void { _pushState.delayMs = ms; }
export function _getPushTokenFetchCount(): number { return _pushState.fetchCount; }
export function _getPermissionRequestCount(): number { return _pushState.permissionRequestCount; }

// Permission state — tests can override to simulate denied/undetermined.
let _permStatus: 'granted' | 'denied' | 'undetermined' = 'granted';
let _permissionRequestResult: 'granted' | 'denied' | 'undetermined' | null = null;
/** Override the permission status returned by getPermissionsAsync/requestPermissionsAsync. */
export function _setPermissionStatus(s: 'granted' | 'denied' | 'undetermined'): void {
  _permStatus = s;
}
export function _setPermissionRequestResult(
  s: 'granted' | 'denied' | 'undetermined',
): void {
  _permissionRequestResult = s;
}

export function _reset(): void {
  _scheduled.length = 0;
  _cancelled.length = 0;
  _requests.length = 0;
  _counter = 0;
  _pushState.token = 'ExponentPushToken[test-1]';
  _pushState.delayMs = 0;
  _pushState.fetchCount = 0;
  _pushState.permissionRequestCount = 0;
  _permStatus = 'granted';
  _permissionRequestResult = null;
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
  return {
    status: _permStatus,
    granted: _permStatus === 'granted',
    canAskAgain: _permStatus !== 'denied',
  };
}

export async function requestPermissionsAsync() {
  _pushState.permissionRequestCount++;
  const status = _permissionRequestResult ?? _permStatus;
  _permStatus = status;
  return {
    status,
    granted: status === 'granted',
    canAskAgain: status === 'undetermined',
  };
}

export async function setNotificationChannelAsync(
  _channelId: string,
  _channel: unknown,
): Promise<void> { /* no-op */ }

export async function scheduleNotificationAsync(
  request: { content?: unknown; trigger?: unknown } | unknown,
): Promise<string> {
  const id = `notif-${++_counter}`;
  _scheduled.push(id);
  const r = request as { content?: unknown; trigger?: unknown } | null;
  _requests.push({ id, content: r?.content, trigger: r?.trigger });
  return id;
}

export async function cancelScheduledNotificationAsync(id: string): Promise<void> {
  _cancelled.push(id);
}
export async function getAllScheduledNotificationsAsync() {
  return _requests.filter(r => !_cancelled.includes(r.id)).map(r => ({
    identifier: r.id,
    content: r.content as { data?: Record<string, unknown> },
    trigger: r.trigger,
  }));
}
export const SchedulableTriggerInputTypes = { DAILY: 'daily', DATE: 'date' } as const;

export const AndroidImportance = { DEFAULT: 3 } as const;
