/**
 * Local notifications must not evaluate Expo's remote-push entry point.
 * SDK 53+ throws during its import in Android Expo Go, before callers can
 * check whether remote push registration is supported.
 */
export * from 'expo-notifications/build/NotificationsEmitter';
export * from 'expo-notifications/build/NotificationsHandler';
export * from 'expo-notifications/build/NotificationPermissions';
export { AndroidImportance } from 'expo-notifications/build/NotificationChannelManager.types';
export { SchedulableTriggerInputTypes } from 'expo-notifications/build/Notifications.types';
export { setNotificationChannelAsync } from 'expo-notifications/build/setNotificationChannelAsync';
export { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
export { cancelScheduledNotificationAsync } from 'expo-notifications/build/cancelScheduledNotificationAsync';
export { getAllScheduledNotificationsAsync } from 'expo-notifications/build/getAllScheduledNotificationsAsync';

import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

export async function getExpoPushTokenAsync(
  ...args: Parameters<typeof import('expo-notifications').getExpoPushTokenAsync>
) {
  if (Platform.OS === 'android'
    && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    throw new Error('Remote push requires a development or standalone Android build.');
  }
  // Preserve the full Expo registration path only where it is supported.
  const remote = await import('expo-notifications');
  return remote.getExpoPushTokenAsync(...args);
}
