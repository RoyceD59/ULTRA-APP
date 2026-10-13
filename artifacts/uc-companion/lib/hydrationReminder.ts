import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
export const HYDRATION_INTERVALS = [2, 3, 4] as const;
export type HydrationInterval = typeof HYDRATION_INTERVALS[number];
export interface HydrationReminderPrefs { enabled: boolean; intervalHours: HydrationInterval }
const validInterval = (value: unknown): value is HydrationInterval =>
  HYDRATION_INTERVALS.some(interval => interval === value);
export function hydrationReminderHours(interval: HydrationInterval): number[] {
  const hours: number[] = [];
  for (let hour = 5; hour <= 20; hour += interval) hours.push(hour);
  return hours;
}
const key = (userId: number) => `uc_hydration_reminder_${userId}`;
export async function getHydrationReminderPrefs(userId: number, strict = false): Promise<HydrationReminderPrefs> {
  const raw = await AsyncStorage.getItem(key(userId));
  const value = raw ? JSON.parse(raw) : {};
  if (strict && (!value || typeof value !== 'object' || Array.isArray(value) ||
    (value.enabled !== undefined && typeof value.enabled !== 'boolean') ||
    (value.intervalHours !== undefined && !validInterval(value.intervalHours)))) {
    throw new Error('Invalid hydration reminder preferences');
  }
  return { enabled: value.enabled === true, intervalHours: validInterval(value.intervalHours) ? value.intervalHours : 3 };
}
export async function saveHydrationReminderPrefs(userId: number, prefs: HydrationReminderPrefs) {
  if (!validInterval(prefs.intervalHours)) throw new Error('Choose every 2, 3, or 4 hours.');
  await AsyncStorage.setItem(key(userId), JSON.stringify(prefs));
}

// One queue across launch, foreground, preference and account changes. A newer
// identity request always wins, even if an OS scheduling call is still pending.
let desiredOwner: number | null = null;
let chain: Promise<unknown> = Promise.resolve();
export function reconcileHydrationReminder(userId: number | null): Promise<'scheduled' | 'disabled' | 'denied' | 'web'> {
  desiredOwner = userId;
  const work = async (): Promise<'scheduled' | 'disabled' | 'denied' | 'web'> => {
    if (Platform.OS === 'web') return 'web';
    const Notifications = await import('./localNotifications');
    const owner = desiredOwner;
    const prefs: HydrationReminderPrefs = owner ? await getHydrationReminderPrefs(owner) : { enabled: false, intervalHours: 3 };
    const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
      .filter(n => n.content.data?.screen === 'hydration');
    const granted = (await Notifications.getPermissionsAsync() as unknown as { granted: boolean }).granted;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const signature = `${owner}:daytime-5-20:${prefs.intervalHours}:${timezone}:${new Date().getTimezoneOffset()}`;
    const hours = hydrationReminderHours(prefs.intervalHours);
    const signatures = hours.map(hour => `${signature}:${hour}`);
    if (owner === desiredOwner && owner && prefs.enabled && granted &&
        scheduled.length === hours.length && signatures.every(expected =>
          scheduled.filter(n => n.content.data?.hydrationSignature === expected).length === 1)) return 'scheduled';
    for (const notification of scheduled) await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    if (owner !== desiredOwner || !owner || !prefs.enabled) return 'disabled';
    if (!granted) return 'denied';
    const { ensureAndroidChannel } = await import('@/hooks/useNotifications');
    await ensureAndroidChannel();
    const ids: string[] = [];
    try {
      for (const hour of hours) {
        if (desiredOwner !== owner) break;
        ids.push(await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Filtered-water reminder',
            body: 'Take a water break and record or update the filtered water you drank today.',
            data: { screen: 'hydration', userId: owner, hydrationSignature: `${signature}:${hour}` },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute: 0, channelId: 'uc-default' },
        }));
      }
    } catch (error) {
      for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id);
      throw error;
    }
    if (desiredOwner !== owner) {
      for (const id of ids) await Notifications.cancelScheduledNotificationAsync(id);
      return 'disabled';
    }
    return 'scheduled';
  };
  const next = chain.then(work, work);
  chain = next.then(() => undefined, () => undefined);
  return next;
}