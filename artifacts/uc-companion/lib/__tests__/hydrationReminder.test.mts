import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from 'react-native';
import AsyncStorage, { _reset as resetStorage } from '@react-native-async-storage/async-storage';
import { _reset as resetNotifications, _requests, _cancelled, _setPermissionStatus, getAllScheduledNotificationsAsync, scheduleNotificationAsync } from 'expo-notifications';
import { getHydrationReminderPrefs, saveHydrationReminderPrefs, reconcileHydrationReminder, hydrationReminderHours } from '../hydrationReminder';

describe('isolated daytime hydration reminders', () => {
  beforeEach(async () => {
    await reconcileHydrationReminder(null);
    resetStorage(); resetNotifications(); Platform.OS = 'ios';
  });
  it('defaults off with a three-hour interval', async () => {
    assert.deepEqual(await getHydrationReminderPrefs(1), { enabled: false, intervalHours: 3 });
    assert.equal(await reconcileHydrationReminder(1), 'disabled');
  });
  for (const os of ['ios', 'android']) {
    for (const intervalHours of [2, 3, 4] as const) {
      it(`${os}: schedules each ${intervalHours}-hour slot exactly once, between 5 am and 8 pm`, async () => {
        Platform.OS = os;
        const expected = intervalHours === 2 ? [5, 7, 9, 11, 13, 15, 17, 19]
          : intervalHours === 3 ? [5, 8, 11, 14, 17, 20] : [5, 9, 13, 17];
        assert.deepEqual(hydrationReminderHours(intervalHours), expected);
        await saveHydrationReminderPrefs(1, { enabled: true, intervalHours });
        assert.equal(await reconcileHydrationReminder(1), 'scheduled');
        await reconcileHydrationReminder(1);
        await reconcileHydrationReminder(1);
        assert.equal(_requests.length, expected.length);
        assert.equal((await getAllScheduledNotificationsAsync()).length, expected.length);
        assert.deepEqual(_requests.map(n => n.trigger), expected.map(hour => ({
          type: 'daily', hour, minute: 0, channelId: 'uc-default',
        })));
        for (const request of _requests) {
          assert.equal((request.content as any).data.screen, 'hydration');
          assert.equal((request.content as any).data.userId, 1);
        }
      });
    }
  }
  it('replaces changed frequency without touching filter or order reminders', async () => {
    const filter = await scheduleNotificationAsync({ content: { data: { screen: 'filterTracker' } }, trigger: {} });
    const order = await scheduleNotificationAsync({ content: { data: { screen: 'orders' } }, trigger: {} });
    await saveHydrationReminderPrefs(1, { enabled: true, intervalHours: 2 });
    await reconcileHydrationReminder(1);
    const old = (await getAllScheduledNotificationsAsync()).filter(n => n.content.data?.screen === 'hydration');
    await saveHydrationReminderPrefs(1, { enabled: true, intervalHours: 4 });
    await reconcileHydrationReminder(1);
    const live = (await getAllScheduledNotificationsAsync()).filter(n => n.content.data?.screen === 'hydration');
    assert.deepEqual(live.map(n => (n.trigger as any).hour), [5, 9, 13, 17]);
    assert.ok(old.every(n => _cancelled.includes(n.identifier)));
    assert.equal(_cancelled.includes(filter), false);
    assert.equal(_cancelled.includes(order), false);
  });
  it('migrates enabled legacy daily preferences and replaces the old schedule', async () => {
    await AsyncStorage.setItem('uc_hydration_reminder_1', JSON.stringify({ enabled: true, time: '20:00' }));
    const old = await scheduleNotificationAsync({ content: { data: { screen: 'hydration', hydrationSignature: 'legacy' } }, trigger: {} });
    assert.deepEqual(await getHydrationReminderPrefs(1), { enabled: true, intervalHours: 3 });
    await reconcileHydrationReminder(1);
    assert.ok(_cancelled.includes(old));
    assert.equal((await getAllScheduledNotificationsAsync()).length, 6);
  });
  it('cancels on disable, logout, permission denial and account switch', async () => {
    await saveHydrationReminderPrefs(1, { enabled: true, intervalHours: 3 });
    await reconcileHydrationReminder(1);
    await saveHydrationReminderPrefs(2, { enabled: true, intervalHours: 4 });
    await reconcileHydrationReminder(2);
    assert.ok((await getAllScheduledNotificationsAsync()).every(n => n.content.data?.userId === 2));
    assert.equal((await getAllScheduledNotificationsAsync()).length, 4);
    await reconcileHydrationReminder(null);
    assert.equal((await getAllScheduledNotificationsAsync()).length, 0);
    await reconcileHydrationReminder(1);
    _setPermissionStatus('denied');
    assert.equal(await reconcileHydrationReminder(1), 'denied');
    assert.equal((await getAllScheduledNotificationsAsync()).length, 0);
    await saveHydrationReminderPrefs(1, { enabled: false, intervalHours: 3 });
    assert.equal(await reconcileHydrationReminder(1), 'disabled');
  });
  it('newer logout wins concurrent reconciliation', async () => {
    await saveHydrationReminderPrefs(1, { enabled: true, intervalHours: 3 });
    await Promise.all([reconcileHydrationReminder(1), reconcileHydrationReminder(null)]);
    assert.equal((await getAllScheduledNotificationsAsync()).length, 0);
  });
  it('web never calls native scheduling, and unsupported intervals are rejected', async () => {
    Platform.OS = 'web';
    await saveHydrationReminderPrefs(1, { enabled: true, intervalHours: 3 });
    assert.equal(await reconcileHydrationReminder(1), 'web');
    assert.equal(_requests.length, 0);
    for (const invalid of [0, 1, 5, '3', null]) {
      await assert.rejects(saveHydrationReminderPrefs(1, { enabled: true, intervalHours: invalid as any }));
    }
  });
  it('replaces stale timezone schedules and repairs duplicate/missing slots', async () => {
    await saveHydrationReminderPrefs(1, { enabled: true, intervalHours: 3 });
    await reconcileHydrationReminder(1);
    const first = _requests[0].id;
    (_requests[0].content as any).data.hydrationSignature = 'old-timezone';
    await reconcileHydrationReminder(1);
    assert.ok(_cancelled.includes(first));
    let live = await getAllScheduledNotificationsAsync();
    assert.equal(live.length, 6);
    (live[0].content as any).data.hydrationSignature = live[1].content.data?.hydrationSignature;
    await reconcileHydrationReminder(1);
    live = await getAllScheduledNotificationsAsync();
    assert.equal(new Set(live.map(n => n.content.data?.hydrationSignature)).size, 6);
  });
});