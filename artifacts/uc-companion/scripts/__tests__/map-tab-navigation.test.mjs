import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { COMPANION_TABS } = require('../../lib/companionLayout.ts');
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
test('every navigation destination has an actual Expo route', () => {
  for (const tab of COMPANION_TABS) assert.ok(existsSync(join(appRoot, 'app', '(tabs)', `${tab.name}.tsx`)), tab.name);
  assert.ok(existsSync(join(appRoot, 'app', '(tabs)', 'map.native.tsx')));
});
test('Map retains its own gestures and a directly reachable tab', () => {
  assert.equal(COMPANION_TABS.filter(tab => tab.name === 'map').length, 1);
  assert.doesNotMatch(readFileSync(join(appRoot, 'app', '(tabs)', 'map.native.tsx'), 'utf8'), /<SwipeTabs\b/);
});
