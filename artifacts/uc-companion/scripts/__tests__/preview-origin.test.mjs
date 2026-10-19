import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Expo preview uses its own routed origin for API calls, not the cross-origin proxy', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.dev, /EXPO_PUBLIC_DOMAIN=\$REPLIT_EXPO_DEV_DOMAIN(?:\s|$)/);
  assert.match(pkg.scripts.dev, /EXPO_PUBLIC_API_DOMAIN=\$REPLIT_EXPO_DEV_DOMAIN(?:\s|$)/);
  assert.doesNotMatch(pkg.scripts.dev, /EXPO_PUBLIC_(?:API_)?DOMAIN=\$REPLIT_DEV_DOMAIN(?:\s|$)/);
});