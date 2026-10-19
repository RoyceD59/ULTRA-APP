import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import AsyncStorage, { _reset, _setGates, _storage } from '@react-native-async-storage/async-storage';
import { getNotifPrefs } from '../../hooks/useNotifications';
import { getHydrationReminderPrefs } from '../hydrationReminder';
import { notificationPreferenceKeys as keys, preferenceReadBlocked } from '../notificationPreferenceState';
import { readFileSync } from 'node:fs';

describe('preference read safety', () => {
  beforeEach(() => _reset());
  it('does not present defaults as loaded when storage fails; retry reads persisted preferences', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const observer = new QueryObserver(client, {
      queryKey: keys.device(1), queryFn: () => getNotifPrefs(true), retry: false,
    });
    try {
      _setGates({ get: async () => { throw new Error('Storage offline'); } });
      const result = await observer.refetch();
      assert.equal(result.isError, true);
      assert.equal(result.data, undefined);
      assert.equal(preferenceReadBlocked(result.data, result.isError, result.isFetching), true);
      _setGates({});
      await AsyncStorage.setItem('uc_notif_prefs', JSON.stringify({ orderUpdates: false, filterReminders: true }));
      const recovered = await observer.refetch();
      assert.deepEqual(recovered.data, { orderUpdates: false, filterReminders: true });
      assert.equal(preferenceReadBlocked(recovered.data, recovered.isError, recovered.isFetching), false);
    } finally { _setGates({}); observer.destroy(); client.clear(); }
  });
  it('failed refresh retains persisted values but still blocks edits', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const saved = { enabled: true, intervalHours: 4 };
    client.setQueryData(keys.hydration(1), saved);
    const observer = new QueryObserver(client, {
      queryKey: keys.hydration(1), queryFn: async () => { throw new Error('Cannot read'); }, retry: false,
    });
    try {
      const result = await observer.refetch();
      assert.deepEqual(result.data, saved);
      assert.equal(preferenceReadBlocked(result.data, result.isError, result.isFetching), true);
      assert.equal(preferenceReadBlocked(saved, false, true), true);
    } finally { observer.destroy(); client.clear(); }
  });
  it('a delayed old-account read never populates the new account', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    let finish!: (value: { enabled: boolean; intervalHours: number }) => void;
    const observer = new QueryObserver(client, {
      queryKey: keys.hydration(1), queryFn: () => new Promise<{ enabled: boolean; intervalHours: number }>(resolve => { finish = resolve; }),
    });
    const read = observer.refetch();
    observer.setOptions({ queryKey: keys.hydration(2), enabled: false });
    finish({ enabled: true, intervalHours: 2 });
    await read;
    assert.equal(observer.getCurrentResult().data, undefined);
    assert.equal(client.getQueryData(keys.hydration(2)), undefined);
    for (const key of [keys.device, keys.hydration, keys.channels]) assert.notDeepEqual(key(1), key(2));
    observer.destroy(); client.clear();
  });
  it('strict reads reject corrupt persisted values instead of enabling default switches', async () => {
    try {
      for (const raw of ['not-json', 'null', '{"enabled":"yes"}', '{"intervalHours":5}']) {
        _storage.set('uc_hydration_reminder_1', raw);
        await assert.rejects(getHydrationReminderPrefs(1, true));
      }
      for (const raw of ['not-json', 'null', '[]', '{"orderUpdates":"yes"}']) {
        _storage.set('uc_notif_prefs', raw);
        await assert.rejects(getNotifPrefs(true));
      }
      _storage.clear();
      assert.deepEqual(await getHydrationReminderPrefs(1, true), { enabled: false, intervalHours: 3 });
      _storage.set('uc_hydration_reminder_1', '{"enabled":true,"time":"20:00"}');
      assert.deepEqual(await getHydrationReminderPrefs(1, true), { enabled: true, intervalHours: 3 });
    } finally { _storage.clear(); }
  });
  it('UI uses scoped reads, blocked guards and an independent daily-water card, never authoritative defaults', () => {
    const source = readFileSync(new URL('../../app/notification-preferences.tsx', import.meta.url), 'utf8');
    assert.match(source, /queryFn: \(\) => getNotifPrefs\(true\)/);
    assert.match(source, /getHydrationReminderPrefs\(user!\.id, true\)/);
    for (const guard of ['localBlocked', 'hydrationBlocked', 'channelBlocked']) {
      assert.match(source, new RegExp(`disabled=\\{saving \\|\\| ${guard}`));
    }
    assert.doesNotMatch(source, /useState<NotifPrefs>|useState<HydrationReminderPrefs>/);
    assert.equal(source.match(/<DailyWaterCard \/>/g)?.length, 1);
    assert.ok(source.indexOf('<DailyWaterCard />') < source.indexOf('HYDRATION REMINDERS'));
    assert.match(source, /activeTokenRef\.current === session/);
  });
});