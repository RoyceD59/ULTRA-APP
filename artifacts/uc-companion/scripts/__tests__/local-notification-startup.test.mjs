import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
test('local notification imports cannot eagerly load Android Expo Go remote push', () => {
  const adapter = readFileSync(resolve(root, 'lib/localNotifications.ts'), 'utf8');
  const modules = [...adapter.matchAll(/^export .* from ['"]expo-notifications\/build\/([^'"]+)['"]/gm)]
    .map(match => resolve(root, 'node_modules/expo-notifications/build', match[1]));
  assert.ok(modules.length >= 8, 'inspect all local entry points');
  const visited = new Set();
  while (modules.length) {
    const base = modules.pop();
    const file = existsSync(`${base}.native.js`) ? `${base}.native.js` : `${base}.js`;
    if (visited.has(file) || !existsSync(file)) continue;
    visited.add(file);
    assert.doesNotMatch(file, /\/(TokenEmitter|DevicePushTokenAutoRegistration\.fx|getDevicePushTokenAsync|getExpoPushTokenAsync|PushTokenManager)(\.native)?\.js$/);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/^(?:import|export)[^\n]*?['"](\.[^'"]+)['"]/gm)) {
      modules.push(resolve(dirname(file), match[1]));
    }
  }
  for (const file of ['hooks/useNotifications.ts', 'hooks/useNativeNotifications.ts', 'lib/hydrationReminder.ts']) {
    // Retained releases may predate the optional hydration feature.
    if (!existsSync(resolve(root, file))) continue;
    assert.doesNotMatch(readFileSync(resolve(root, file), 'utf8'), /from ['"]expo-notifications['"]|import\(['"]expo-notifications['"]\)/);
  }
  assert.match(adapter, /await import\('expo-notifications'\)/, 'standalone remote registration remains available');
});
