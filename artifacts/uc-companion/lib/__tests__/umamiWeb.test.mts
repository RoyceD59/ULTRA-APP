import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createWebAnalyticsLoader, sanitizeTrackerMetadata, UMAMI_SCRIPT_URL, UMAMI_WEBSITE_ID } from '../umamiWeb';

function fixture(hostname = 'app.ucfilters.com', doNotTrack = '0') {
  const scripts: any[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const browser = {
    location: { hostname },
    navigator: { doNotTrack },
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
    document: {
      createElement: () => ({
        attributes: {} as Record<string, string>,
        setAttribute(name: string, value: string) { this.attributes[name] = value; },
        remove() { scripts.splice(scripts.indexOf(this), 1); },
      }),
      head: { appendChild: (script: any) => scripts.push(script) },
    },
    umami: undefined as Window['umami'],
  };
  const loader = createWebAnalyticsLoader(() => browser as unknown as Window);
  return { browser, scripts, timers, loader };
}

test('production-only loader installs the supplied tracker once with privacy controls', () => {
  const { loader, scripts } = fixture();
  assert.equal(loader.initialize(), true);
  loader.initialize();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, UMAMI_SCRIPT_URL);
  assert.equal(scripts[0].attributes['data-website-id'], UMAMI_WEBSITE_ID);
  for (const attr of ['data-exclude-search', 'data-exclude-hash', 'data-do-not-track']) {
    assert.equal(scripts[0].attributes[attr], 'true');
  }
  assert.equal(scripts[0].attributes['data-before-send'], 'companionAnalyticsBeforeSend');
  assert.equal(scripts[0].referrerPolicy, 'no-referrer');
});

test('native/server, preview domains and Do Not Track do not install a tracker', () => {
  assert.equal(createWebAnalyticsLoader(() => undefined).initialize(), false);
  for (const host of ['localhost', 'preview.replit.dev', 'api.ucfilters.com']) {
    const { loader, scripts } = fixture(host);
    assert.equal(loader.initialize(), false);
    assert.equal(scripts.length, 0);
  }
  const { loader, scripts } = fixture('app.ucfilters.com', '1');
  assert.equal(loader.initialize(), false);
  assert.equal(scripts.length, 0);
  const layout = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /if \(Platform\.OS === 'web'\) webAnalyticsLoader\.initialize\(\)/);
});

test('events wait for load, flush once and keep a bounded memory-only queue', () => {
  const { loader, scripts, browser, timers } = fixture();
  let sent = 0;
  for (let i = 0; i < 75; i++) assert.equal(loader.queueUntilReady(() => sent++), true);
  assert.equal(sent, 0);
  browser.umami = { track() {} };
  scripts[0].onload();
  assert.equal(sent, 50);
  scripts[0].onload();
  assert.equal(sent, 50);
  assert.equal(timers.size, 0);
  assert.equal(loader.queueUntilReady(() => sent++), false);
});

test('blocked, timed-out and missing tracker scripts drop queued events without throwing', () => {
  for (const failure of ['error', 'timeout', 'missing'] as const) {
    const { loader, scripts, timers, browser } = fixture();
    let sent = 0;
    loader.queueUntilReady(() => sent++);
    const script = scripts[0];
    if (failure === 'error') script.onerror();
    if (failure === 'timeout') [...timers.values()][0]();
    if (failure === 'missing') script.onload();
    assert.equal(sent, 0);
    assert.equal(loader.initialize(), false);
    assert.equal(timers.size, 0);
    assert.equal(scripts.length, 0);
    assert.equal((browser as unknown as Window).companionAnalyticsBeforeSend?.('event', { url: '/' }), false);
  }
});

test('DOM setup failures never escape into the app', () => {
  const { browser, loader } = fixture();
  browser.document.createElement = () => { throw new Error('DOM blocked'); };
  assert.doesNotThrow(() => assert.equal(loader.initialize(), false));
});

test('before-send scrubs URL query/hash, referring paths and document titles', () => {
  assert.deepEqual(sanitizeTrackerMetadata('event', {
    url: '/auth/reset-password?resetToken=private#secret',
    referrer: 'https://example.test/private-person?email=private#secret',
    title: 'Private customer title', name: 'article_opened', data: { articleId: '123' },
  }), {
    url: '/auth/reset-password',
    referrer: 'https://example.test',
    title: 'Ultra-Clear Companion', name: 'article_opened', data: { articleId: '123' },
  });
});