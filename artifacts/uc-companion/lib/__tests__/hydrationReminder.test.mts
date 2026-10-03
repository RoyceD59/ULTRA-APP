import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from 'react-native';
import { _reset as resetStorage } from '@react-native-async-storage/async-storage';
import { _reset as resetNotifications, _requests, _cancelled, _setPermissionStatus, getAllScheduledNotificationsAsync, scheduleNotificationAsync } from 'expo-notifications';
import { getHydrationReminderPrefs, saveHydrationReminderPrefs, reconcileHydrationReminder } from '../hydrationReminder';

describe('isolated native daily hydration reminders', () => {
  beforeEach(async () => {
    await reconcileHydrationReminder(null);
    resetStorage(); resetNotifications(); Platform.OS = 'ios';
  });
  it('defaults off with 20:00 suggested and schedules one repeating local reminder', async () => {
    assert.deepEqual(await getHydrationReminderPrefs(1), { enabled: false, time: '20:00' });
    assert.equal(await reconcileHydrationReminder(1), 'disabled');
    await saveHydrationReminderPrefs(1, { enabled: true, time: '20:00' });
    assert.equal(await reconcileHydrationReminder(1), 'scheduled');
    await reconcileHydrationReminder(1);
    assert.equal((await getAllScheduledNotificationsAsync()).length, 1);
    assert.deepEqual(_requests[0].trigger, { type: 'daily', hour: 20, minute: 0, channelId: 'uc-default' });
    assert.equal((_requests[0].content as any).data.screen, 'hydration');
  });
  it('changing time cancels the old reminder without touching filter schedules', async () => {
    const filter = await scheduleNotificationAsync({ content: { data: { screen: 'filterTracker' } }, trigger: {} });
    await saveHydrationReminderPrefs(1, { enabled: true, time: '20:00' });
    await reconcileHydrationReminder(1);
    await saveHydrationReminderPrefs(1, { enabled: true, time: '21:30' });
    await reconcileHydrationReminder(1);
    const live = await getAllScheduledNotificationsAsync();
    assert.equal(live.filter(n => n.content.data?.screen === 'hydration').length, 1);
    assert.equal(_cancelled.includes(filter), false);
    assert.equal((live.find(n => n.content.data?.screen === 'hydration')?.trigger as any).minute, 30);
  });
  it('cancels on disable, logout, permission denial and account switch', async () => {
    await saveHydrationReminderPrefs(1, { enabled: true, time: '20:00' });
    await reconcileHydrationReminder(1);
    await reconcileHydrationReminder(2);
    assert.equal((await getAllScheduledNotificationsAsync()).length, 0);
    await reconcileHydrationReminder(1);
    await reconcileHydrationReminder(null);
    assert.equal((await getAllScheduledNotificationsAsync()).length, 0);
    await reconcileHydrationReminder(1);
    _setPermissionStatus('denied');
    assert.equal(await reconcileHydrationReminder(1), 'denied');
    assert.equal((await getAllScheduledNotificationsAsync()).length, 0);
    await saveHydrationReminderPrefs(1, { enabled: false, time: '20:00' });
    assert.equal(await reconcileHydrationReminder(1), 'disabled');
  });
  it('newer logout wins concurrent reconciliation', async () => {
    await saveHydrationReminderPrefs(1, { enabled: true, time: '20:00' });
    await Promise.all([reconcileHydrationReminder(1), reconcileHydrationReminder(null)]);
    assert.equal((await getAllScheduledNotificationsAsync()).length, 0);
  });
  it('web never calls native scheduling, and malformed times are rejected', async () => {
    Platform.OS = 'web';
    await saveHydrationReminderPrefs(1, { enabled: true, time: '20:00' });
    assert.equal(await reconcileHydrationReminder(1), 'web');
    assert.equal(_requests.length, 0);
    await assert.rejects(saveHydrationReminderPrefs(1, { enabled: true, time: '25:00' }));
  });
  it('reconciles a changed timezone signature on foreground', async () => {
    await saveHydrationReminderPrefs(1, { enabled: true, time: '20:00' });
    await reconcileHydrationReminder(1);
    const first = _requests[0].id;
    (_requests[0].content as any).data.hydrationSignature = 'old-timezone';
    await reconcileHydrationReminder(1);
    assert.equal(_cancelled.includes(first), true);
    assert.equal((await getAllScheduledNotificationsAsync()).length, 1);
  });
});