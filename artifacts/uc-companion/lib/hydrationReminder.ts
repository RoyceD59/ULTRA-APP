import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { validReminderTime } from './hydration';

export interface HydrationReminderPrefs { enabled: boolean; time: string }
const key = (userId: number) => `uc_hydration_reminder_${userId}`;
export async function getHydrationReminderPrefs(userId: number): Promise<HydrationReminderPrefs> {
  const raw = await AsyncStorage.getItem(key(userId));
  const value = raw ? JSON.parse(raw) : {};
  return { enabled: value.enabled === true, time: validReminderTime(value.time ?? '') ? value.time : '20:00' };
}
export async function saveHydrationReminderPrefs(userId: number, prefs: HydrationReminderPrefs) {
  if (!validReminderTime(prefs.time)) throw new Error('Use a local time in HH:MM format.');
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
    const Notifications = await import('expo-notifications');
    const owner = desiredOwner;
    const prefs = owner ? await getHydrationReminderPrefs(owner) : { enabled: false, time: '20:00' };
    const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
      .filter(n => n.content.data?.screen === 'hydration');
    const granted = (await Notifications.getPermissionsAsync() as unknown as { granted: boolean }).granted;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const signature = `${owner}:${prefs.time}:${timezone}:${new Date().getTimezoneOffset()}`;
    if (owner === desiredOwner && owner && prefs.enabled && granted &&
        scheduled.length === 1 && scheduled[0].content.data?.hydrationSignature === signature) return 'scheduled';
    for (const notification of scheduled) await Notifications.cancelScheduledNotificationAsync(notification.identifier);
    if (owner !== desiredOwner || !owner || !prefs.enabled) return 'disabled';
    if (!granted) return 'denied';
    const { ensureAndroidChannel } = await import('@/hooks/useNotifications');
    await ensureAndroidChannel();
    const [hour, minute] = prefs.time.split(':').map(Number);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Daily filtered water',
        body: 'Record or update the filtered water you drank today.',
        data: { screen: 'hydration', userId: owner, hydrationSignature: signature },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: 'uc-default' },
    });
    if (desiredOwner !== owner) {
      await Notifications.cancelScheduledNotificationAsync(id);
      return 'disabled';
    }
    return 'scheduled';
  };
  const next = chain.then(work, work);
  chain = next.then(() => undefined, () => undefined);
  return next;
}