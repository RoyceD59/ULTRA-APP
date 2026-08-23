/**
 * End-to-end tests for the production serve.js server.
 *
 * The suite forms a true document → bundle chain:
 *
 *  1. GET /uc-companion/  → HTML contains <script src="…bundle.js">
 *  2. Fetch the exact src URL extracted from that HTML → HTTP 200,
 *     content-type: application/javascript
 *  3. GET /uc-companion/guide/filter-care (with Accept: text/html) also
 *     returns HTML whose <script src> resolves to the same bundle URL
 *  4. GET /uc-companion/status → "ok"
 *
 * The server is started against a minimal temporary static-build fixture so
 * the test is self-contained and does not depend on a previously-built
 * artefact.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const SERVE_JS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'server',
  'serve.js',
);

const BASE_PATH = '/uc-companion';

/** Ask the OS for an available TCP port. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = /** @type {net.AddressInfo} */ (srv.address()).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Poll /status until the server responds or the timeout elapses. */
async function waitForReady(port, maxWaitMs = 8000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${BASE_PATH}/status`);
      if (res.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `serve.js did not respond on port ${port} within ${maxWaitMs} ms`,
  );
}

/**
 * Extract the first <script src="…"> value from an HTML string.
 * Returns null if none found.
 * @param {string} html
 */
function extractScriptSrc(html) {
  const match = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/);
  return match ? match[1] : null;
}

describe('serve.js production server', () => {
  /** @type {import('node:child_process').ChildProcess} */
  let serverProcess;
  let port;
  let staticRoot;

  /**
   * The bundle URL extracted from the root HTML response.
   * e.g. /uc-companion/1234567890-99999/_expo/static/js/web/bundle.js
   * Set during the before() hook so all tests share the real document-derived URL.
   * @type {string}
   */
  let bundleSrcFromRoot;

  before(async () => {
    // ----- build a minimal static-build fixture -----
    staticRoot = mkdtempSync(join(tmpdir(), 'uc-serve-test-'));

    const timestamp = '1234567890-99999';
    const webBundleDir = join(
      staticRoot,
      timestamp,
      '_expo',
      'static',
      'js',
      'web',
    );
    mkdirSync(webBundleDir, { recursive: true });
    writeFileSync(
      join(webBundleDir, 'bundle.js'),
      '// minimal test bundle\nconsole.log("uc-companion-web");\n',
    );

    // ----- create ios and android manifest fixtures -----
    // Mirrors the shape written by build.js updateManifests():
    //   launchAsset.url is the absolute bundle URL embedded during the build.
    for (const platform of ['ios', 'android']) {
      const platformDir = join(staticRoot, platform);
      mkdirSync(platformDir, { recursive: true });
      writeFileSync(
        join(platformDir, 'manifest.json'),
        JSON.stringify(
          {
            launchAsset: {
              url: `https://example.com${BASE_PATH}/${timestamp}/_expo/static/js/${platform}/bundle.js`,
              key: `bundle-${timestamp}`,
            },
            assets: [],
            extra: {
              expoClient: { hostUri: 'example.com' },
              expoGo: { debuggerHost: 'example.com', packagerOpts: { dev: false } },
            },
          },
          null,
          2,
        ),
      );
    }

    // ----- start the server -----
    port = await findFreePort();
    serverProcess = spawn(process.execPath, [SERVE_JS], {
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH,
        STATIC_ROOT: staticRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Surface server stderr only when the process exits non-zero.
    const stderrChunks = [];
    serverProcess.stderr.on('data', (d) => stderrChunks.push(d));
    serverProcess.on('exit', (code) => {
      if (code && code !== 0) {
        process.stderr.write(Buffer.concat(stderrChunks));
      }
    });

    await waitForReady(port);

    // ----- fetch root HTML and extract the bundle src once -----
    // All subsequent tests that need the bundle URL reuse this value so
    // they exercise the actual document-to-bundle path.
    const rootRes = await fetch(`http://127.0.0.1:${port}${BASE_PATH}/`);
    const rootHtml = await rootRes.text();
    const src = extractScriptSrc(rootHtml);
    if (!src) {
      throw new Error(
        'Could not extract <script src="…"> from root HTML during test setup',
      );
    }
    bundleSrcFromRoot = src;
  });

  after(() => {
    serverProcess?.kill();
    if (staticRoot) rmSync(staticRoot, { recursive: true, force: true });
  });

  /** Convenience wrapper that always targets the local server. */
  function get(path, headers = {}) {
    return fetch(`http://127.0.0.1:${port}${path}`, { headers });
  }

  // ── 1. Root path returns HTML with a <script src="…bundle.js"> ──────────

  test('GET /uc-companion/ returns HTML containing a <script src="…/bundle.js"> tag', async () => {
    const res = await get(`${BASE_PATH}/`);

    assert.equal(res.status, 200, 'expected HTTP 200');
    assert.match(
      res.headers.get('content-type') ?? '',
      /text\/html/,
      'expected text/html content-type',
    );

    const html = await res.text();
    const src = extractScriptSrc(html);
    assert.ok(src !== null, 'HTML should contain a <script src="…"> tag');
    assert.match(src, /bundle\.js$/, '<script src> should end with bundle.js');
  });

  // ── 2. The src extracted from root HTML fetches a real JS file ───────────

  test('The <script src> from root HTML fetches HTTP 200 with content-type: application/javascript', async () => {
    // bundleSrcFromRoot is the *actual* URL the server embedded in the HTML,
    // e.g. /uc-companion/1234567890-99999/_expo/static/js/web/bundle.js
    assert.ok(
      bundleSrcFromRoot,
      'bundleSrcFromRoot must have been set during before()',
    );
    assert.match(bundleSrcFromRoot, /bundle\.js$/, 'src should end with bundle.js');

    const res = await get(bundleSrcFromRoot);

    assert.equal(res.status, 200, `expected HTTP 200 fetching ${bundleSrcFromRoot}`);
    assert.match(
      res.headers.get('content-type') ?? '',
      /application\/javascript/,
      'expected application/javascript content-type for bundle URL',
    );
  });

  // ── 3. Deep-link paths fall back to the same web bundle HTML ─────────────

  test('GET /uc-companion/guide/filter-care serves HTML whose <script src> resolves to the same bundle', async () => {
    const res = await get(`${BASE_PATH}/guide/filter-care`, {
      accept: 'text/html,application/xhtml+xml,*/*',
    });

    assert.equal(res.status, 200, 'expected HTTP 200 for deep-link path');
    assert.match(
      res.headers.get('content-type') ?? '',
      /text\/html/,
      'expected text/html content-type for deep-link path',
    );

    const html = await res.text();
    const src = extractScriptSrc(html);
    assert.ok(src !== null, 'deep-link HTML should contain a <script src="…"> tag');
    assert.equal(
      src,
      bundleSrcFromRoot,
      'deep-link HTML should embed the same bundle URL as the root page',
    );
  });

  // ── 4. Health-check endpoint ──────────────────────────────────────────────

  test('GET /uc-companion/status returns "ok"', async () => {
    const res = await get(`${BASE_PATH}/status`);

    assert.equal(res.status, 200, 'expected HTTP 200 for /status');
    const body = await res.text();
    assert.equal(body, 'ok', 'expected body to be "ok"');
  });

  // ── 5. iOS manifest route ─────────────────────────────────────────────────

  test('GET / with expo-platform: ios returns 200 JSON with expo-protocol-version header', async () => {
    const res = await get(`${BASE_PATH}/`, { 'expo-platform': 'ios' });

    assert.equal(res.status, 200, 'expected HTTP 200 for iOS manifest');
    assert.match(
      res.headers.get('content-type') ?? '',
      /application\/json/,
      'expected application/json content-type for iOS manifest',
    );
    assert.equal(
      res.headers.get('expo-protocol-version'),
      '1',
      'expected expo-protocol-version: 1 header for iOS manifest',
    );
  });

  test('iOS manifest launchAsset.url points to the expected bundle path', async () => {
    const res = await get(`${BASE_PATH}/`, { 'expo-platform': 'ios' });

    assert.equal(res.status, 200, 'expected HTTP 200 for iOS manifest');
    const manifest = await res.json();
    assert.ok(
      manifest.launchAsset && typeof manifest.launchAsset.url === 'string',
      'iOS manifest should have a launchAsset.url string',
    );
    assert.match(
      manifest.launchAsset.url,
      /\/_expo\/static\/js\/ios\/bundle\.js$/,
      'iOS manifest launchAsset.url should point to the ios bundle.js',
    );
  });

  // ── 6. Android manifest route ─────────────────────────────────────────────

  test('GET / with expo-platform: android returns 200 JSON with expo-protocol-version header', async () => {
    const res = await get(`${BASE_PATH}/`, { 'expo-platform': 'android' });

    assert.equal(res.status, 200, 'expected HTTP 200 for Android manifest');
    assert.match(
      res.headers.get('content-type') ?? '',
      /application\/json/,
      'expected application/json content-type for Android manifest',
    );
    assert.equal(
      res.headers.get('expo-protocol-version'),
      '1',
      'expected expo-protocol-version: 1 header for Android manifest',
    );
  });

  test('Android manifest launchAsset.url points to the expected bundle path', async () => {
    const res = await get(`${BASE_PATH}/`, { 'expo-platform': 'android' });

    assert.equal(res.status, 200, 'expected HTTP 200 for Android manifest');
    const manifest = await res.json();
    assert.ok(
      manifest.launchAsset && typeof manifest.launchAsset.url === 'string',
      'Android manifest should have a launchAsset.url string',
    );
    assert.match(
      manifest.launchAsset.url,
      /\/_expo\/static\/js\/android\/bundle\.js$/,
      'Android manifest launchAsset.url should point to the android bundle.js',
    );
  });

  // ── 7. /manifest route with a valid STATIC_ROOT ──────────────────────────

  test('GET /manifest with expo-platform: ios returns 200 JSON with expo-protocol-version header and a valid launchAsset.url', async () => {
    const res = await get(`${BASE_PATH}/manifest`, { 'expo-platform': 'ios' });

    assert.equal(res.status, 200, 'expected HTTP 200 for iOS manifest via /manifest route');
    assert.match(
      res.headers.get('content-type') ?? '',
      /application\/json/,
      'expected application/json content-type for iOS manifest via /manifest route',
    );
    assert.equal(
      res.headers.get('expo-protocol-version'),
      '1',
      'expected expo-protocol-version: 1 header for iOS manifest via /manifest route',
    );
    const manifest = await res.json();
    assert.ok(
      manifest.launchAsset && typeof manifest.launchAsset.url === 'string',
      'iOS manifest from /manifest route should have a launchAsset.url string',
    );
    assert.match(
      manifest.launchAsset.url,
      /\/_expo\/static\/js\/ios\/bundle\.js$/,
      'iOS manifest from /manifest route launchAsset.url should point to the ios bundle.js',
    );
  });

  test('GET /manifest with expo-platform: android returns 200 JSON with expo-protocol-version header and a valid launchAsset.url', async () => {
    const res = await get(`${BASE_PATH}/manifest`, { 'expo-platform': 'android' });

    assert.equal(res.status, 200, 'expected HTTP 200 for Android manifest via /manifest route');
    assert.match(
      res.headers.get('content-type') ?? '',
      /application\/json/,
      'expected application/json content-type for Android manifest via /manifest route',
    );
    assert.equal(
      res.headers.get('expo-protocol-version'),
      '1',
      'expected expo-protocol-version: 1 header for Android manifest via /manifest route',
    );
    const manifest = await res.json();
    assert.ok(
      manifest.launchAsset && typeof manifest.launchAsset.url === 'string',
      'Android manifest from /manifest route should have a launchAsset.url string',
    );
    assert.match(
      manifest.launchAsset.url,
      /\/_expo\/static\/js\/android\/bundle\.js$/,
      'Android manifest from /manifest route launchAsset.url should point to the android bundle.js',
    );
  });

  // ── 8. Manifest route: missing manifest returns 404 ───────────────────────

  test('GET / with expo-platform: ios returns 404 when manifest.json is absent', async () => {
    // Start a separate server instance with an empty static root so there is
    // no ios/manifest.json.  We reuse the same SERVE_JS but point it at a
    // fresh, empty tmpdir.
    const emptyRoot = mkdtempSync(join(tmpdir(), 'uc-serve-empty-'));
    const emptyPort = await findFreePort();
    const emptyServer = spawn(process.execPath, [SERVE_JS], {
      env: {
        ...process.env,
        PORT: String(emptyPort),
        BASE_PATH,
        STATIC_ROOT: emptyRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await waitForReady(emptyPort);
      const res = await fetch(`http://127.0.0.1:${emptyPort}${BASE_PATH}/`, {
        headers: { 'expo-platform': 'ios' },
      });
      assert.equal(
        res.status,
        404,
        'expected HTTP 404 when ios/manifest.json does not exist',
      );
    } finally {
      emptyServer.kill();
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  // ── 8. Rebuild scenario: server picks up a new bundle without restarting ──

  test('server re-scans and serves the new bundle after the old timestamped directory is replaced', async () => {
    // This test exercises the bundle-path cache invalidation path in
    // getWebBundlePath(): when the cached path no longer exists on disk (old
    // directory deleted by a rebuild), the server must rescan and find the
    // newly-written bundle — all without a restart.

    const rebuildRoot = mkdtempSync(join(tmpdir(), 'uc-serve-rebuild-'));
    const rebuildPort = await findFreePort();

    /**
     * Helper: create a timestamped web-bundle directory inside rebuildRoot.
     * Returns the bundle path so callers can verify or delete it.
     * @param {string} timestamp  directory name — must sort correctly (higher = newer)
     * @param {string} marker     content written into bundle.js to identify the build
     */
    function createBundle(timestamp, marker) {
      const bundleDir = join(
        rebuildRoot,
        timestamp,
        '_expo',
        'static',
        'js',
        'web',
      );
      mkdirSync(bundleDir, { recursive: true });
      writeFileSync(
        join(bundleDir, 'bundle.js'),
        `// ${marker}\nconsole.log("${marker}");\n`,
      );
      return join(bundleDir, 'bundle.js');
    }

    // "Old" build: lower timestamp → sorts earlier alphabetically
    const oldTimestamp = '1000000000-00001';
    createBundle(oldTimestamp, 'old-bundle');

    const rebuildServer = spawn(process.execPath, [SERVE_JS], {
      env: {
        ...process.env,
        PORT: String(rebuildPort),
        BASE_PATH,
        STATIC_ROOT: rebuildRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await waitForReady(rebuildPort);

      // ── Step 1: warm the cache — verify the server finds the old bundle ──
      const res1 = await fetch(`http://127.0.0.1:${rebuildPort}${BASE_PATH}/`);
      assert.equal(res1.status, 200, 'expected HTTP 200 before rebuild');
      const html1 = await res1.text();
      const src1 = extractScriptSrc(html1);
      assert.ok(src1, 'root HTML should contain a <script src="…"> before rebuild');
      assert.match(src1, /bundle\.js$/, 'src should end with bundle.js before rebuild');
      assert.ok(
        src1.includes(oldTimestamp),
        `initial bundle URL should contain the old timestamp "${oldTimestamp}"; got: ${src1}`,
      );

      // ── Step 2: simulate a rebuild ────────────────────────────────────────
      // Remove the old timestamped directory (invalidates the cache) and write
      // a new one with a higher-sorting timestamp.
      rmSync(join(rebuildRoot, oldTimestamp), { recursive: true, force: true });

      const newTimestamp = '2000000000-00002';
      createBundle(newTimestamp, 'new-bundle');

      // ── Step 3: request again — server must rescan and serve the new bundle
      const res2 = await fetch(`http://127.0.0.1:${rebuildPort}${BASE_PATH}/`);
      assert.equal(res2.status, 200, 'expected HTTP 200 after rebuild');
      const html2 = await res2.text();
      const src2 = extractScriptSrc(html2);
      assert.ok(src2, 'root HTML should contain a <script src="…"> after rebuild');
      assert.match(src2, /bundle\.js$/, 'src should end with bundle.js after rebuild');
      assert.ok(
        src2.includes(newTimestamp),
        `post-rebuild bundle URL should contain the new timestamp "${newTimestamp}"; got: ${src2}`,
      );
      assert.notEqual(
        src2,
        src1,
        'bundle URL should differ from the pre-rebuild URL after the directory is replaced',
      );

      // ── Step 4: the new bundle file itself should be fetchable ────────────
      const bundleRes = await fetch(`http://127.0.0.1:${rebuildPort}${src2}`);
      assert.equal(
        bundleRes.status,
        200,
        `expected HTTP 200 fetching new bundle at ${src2}`,
      );
      assert.match(
        bundleRes.headers.get('content-type') ?? '',
        /application\/javascript/,
        'new bundle should be served with application/javascript content-type',
      );
    } finally {
      rebuildServer.kill();
      rmSync(rebuildRoot, { recursive: true, force: true });
    }
  });

  // ── 9. Deep-link during rebuild gap: bundle deleted, replacement not yet written ──

  test('deep-link GET with Accept: text/html returns the landing page when the bundle directory has been deleted but not yet replaced', async () => {
    // This test covers the window between old-bundle removal and new-bundle
    // arrival.  The server must never crash or return a blank response; instead
    // it should fall back to the landing page so the user sees something
    // meaningful rather than an empty page or a 500.

    const gapRoot = mkdtempSync(join(tmpdir(), 'uc-serve-gap-'));
    const gapPort = await findFreePort();

    // Start with a valid bundle so the server warms its cache.
    const initialTimestamp = '1000000000-00001';
    const bundleDir = join(
      gapRoot,
      initialTimestamp,
      '_expo',
      'static',
      'js',
      'web',
    );
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(
      join(bundleDir, 'bundle.js'),
      '// initial bundle\nconsole.log("initial");\n',
    );

    const gapServer = spawn(process.execPath, [SERVE_JS], {
      env: {
        ...process.env,
        PORT: String(gapPort),
        BASE_PATH,
        STATIC_ROOT: gapRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await waitForReady(gapPort);

      // Warm the cache: the server now knows about the initial bundle.
      const warmRes = await fetch(`http://127.0.0.1:${gapPort}${BASE_PATH}/`);
      assert.equal(warmRes.status, 200, 'expected HTTP 200 before bundle removal');

      // Simulate the rebuild gap: delete the bundle directory without writing
      // a replacement — exactly the intermediate state the task covers.
      rmSync(join(gapRoot, initialTimestamp), { recursive: true, force: true });

      // A deep-link request (Accept: text/html) must NOT crash or return a
      // blank page; it should fall back to the landing page gracefully.
      const deepLinkRes = await fetch(
        `http://127.0.0.1:${gapPort}${BASE_PATH}/guide/filter-care`,
        { headers: { accept: 'text/html,application/xhtml+xml,*/*' } },
      );

      assert.equal(
        deepLinkRes.status,
        200,
        'deep-link during rebuild gap should return HTTP 200 (landing page), not a 500 or crash',
      );
      assert.match(
        deepLinkRes.headers.get('content-type') ?? '',
        /text\/html/,
        'deep-link during rebuild gap should return text/html (landing page)',
      );

      const body = await deepLinkRes.text();
      assert.ok(
        body.trim().length > 0,
        'landing-page response body must not be empty during the rebuild gap',
      );
      // The landing page must NOT embed a <script src="…bundle.js"> reference
      // because no bundle exists yet; a dangling bundle reference would cause a
      // blank/broken page in the browser.  Note: the landing page may contain
      // other <script src> tags (e.g. QR-code library) which are fine.
      const bundleScriptMatch = body.match(
        /<script\b[^>]*\bsrc="([^"]*bundle\.js[^"]*)"[^>]*>/,
      );
      assert.equal(
        bundleScriptMatch,
        null,
        'landing page served during rebuild gap must not embed a <script src> pointing to a missing bundle.js',
      );

      // ── Recovery phase: write the replacement bundle ─────────────────────
      // Simulate the rebuild completing — write a new timestamped bundle.
      // The server must automatically discover it on the next request without
      // a restart; the cached null from the gap must not be sticky.
      const replacementTimestamp = '2000000000-00002';
      const replacementBundleDir = join(
        gapRoot,
        replacementTimestamp,
        '_expo',
        'static',
        'js',
        'web',
      );
      mkdirSync(replacementBundleDir, { recursive: true });
      writeFileSync(
        join(replacementBundleDir, 'bundle.js'),
        '// replacement bundle\nconsole.log("replacement");\n',
      );

      // Next deep-link request must serve the web-app HTML (with the new
      // bundle URL), not the landing page, because the bundle now exists.
      const recoveryRes = await fetch(
        `http://127.0.0.1:${gapPort}${BASE_PATH}/guide/filter-care`,
        { headers: { accept: 'text/html,application/xhtml+xml,*/*' } },
      );

      assert.equal(
        recoveryRes.status,
        200,
        'deep-link after bundle replacement should return HTTP 200',
      );

      const recoveryHtml = await recoveryRes.text();
      const recoverySrc = extractScriptSrc(recoveryHtml);
      assert.ok(
        recoverySrc !== null,
        'HTML after recovery should contain a <script src="…"> pointing to the new bundle',
      );
      assert.match(
        recoverySrc,
        /bundle\.js$/,
        'recovered <script src> should end with bundle.js',
      );
      assert.ok(
        recoverySrc.includes(replacementTimestamp),
        `recovered bundle URL should contain the replacement timestamp "${replacementTimestamp}"; got: ${recoverySrc}`,
      );

      // Confirm the embedded bundle URL is actually fetchable.
      const recoveryBundleRes = await fetch(
        `http://127.0.0.1:${gapPort}${recoverySrc}`,
      );
      assert.equal(
        recoveryBundleRes.status,
        200,
        `expected HTTP 200 fetching recovered bundle at ${recoverySrc}`,
      );
      assert.match(
        recoveryBundleRes.headers.get('content-type') ?? '',
        /application\/javascript/,
        'recovered bundle should be served with application/javascript content-type',
      );
    } finally {
      gapServer.kill();
      rmSync(gapRoot, { recursive: true, force: true });
    }
  });
});

// ── Absent STATIC_ROOT suite ─────────────────────────────────────────────────

describe('serve.js — absent STATIC_ROOT', () => {
  /** @type {import('node:child_process').ChildProcess} */
  let serverProcess;
  let port;

  before(async () => {
    // Point STATIC_ROOT at a path that does not exist on disk — never create it.
    const absentRoot = join(tmpdir(), `uc-serve-absent-${Date.now()}`);

    port = await findFreePort();
    serverProcess = spawn(process.execPath, [SERVE_JS], {
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH,
        STATIC_ROOT: absentRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderrChunks = [];
    serverProcess.stderr.on('data', (d) => stderrChunks.push(d));
    serverProcess.on('exit', (code) => {
      if (code && code !== 0) {
        process.stderr.write(Buffer.concat(stderrChunks));
      }
    });

    await waitForReady(port);
  });

  after(() => {
    serverProcess?.kill();
  });

  /** Convenience wrapper that always targets the absent-root server. */
  function get(urlPath, headers = {}) {
    return fetch(`http://127.0.0.1:${port}${urlPath}`, { headers });
  }

  // ── 1. Root path returns the landing page (no bundle script tag) ──────────

  test('GET / returns HTTP 200 with a landing page and no <script src="…bundle.js"> when STATIC_ROOT is absent', async () => {
    const res = await get(`${BASE_PATH}/`);

    assert.equal(
      res.status,
      200,
      'expected HTTP 200 for landing page even when STATIC_ROOT does not exist',
    );
    assert.match(
      res.headers.get('content-type') ?? '',
      /text\/html/,
      'expected text/html content-type for landing page',
    );

    const html = await res.text();

    // The landing page may include its own <script> tags (e.g. QR-code library),
    // but must NOT contain a <script src="…bundle.js"> injected by serveWebApp().
    const bundleSrcMatch = html.match(/<script\b[^>]*\bsrc="([^"]*bundle\.js[^"]*)"[^>]*>/);
    assert.equal(
      bundleSrcMatch,
      null,
      'landing page must not contain a <script src="…bundle.js"> tag when STATIC_ROOT is absent',
    );
  });

  // ── 2. Health-check is unaffected by the missing directory ────────────────

  test('GET /status returns "ok" when STATIC_ROOT is absent', async () => {
    const res = await get(`${BASE_PATH}/status`);

    assert.equal(res.status, 200, 'expected HTTP 200 for /status');
    const body = await res.text();
    assert.equal(body, 'ok', 'expected body to be "ok"');
  });

  // ── 3. Platform manifest routes return 404 when STATIC_ROOT is absent ─────

  test('GET / with expo-platform: ios returns HTTP 404 when STATIC_ROOT does not exist', async () => {
    const res = await get(`${BASE_PATH}/`, { 'expo-platform': 'ios' });

    assert.equal(
      res.status,
      404,
      'expected HTTP 404 for iOS manifest when STATIC_ROOT is absent',
    );
  });

  test('GET / with expo-platform: android returns HTTP 404 when STATIC_ROOT does not exist', async () => {
    const res = await get(`${BASE_PATH}/`, { 'expo-platform': 'android' });

    assert.equal(
      res.status,
      404,
      'expected HTTP 404 for Android manifest when STATIC_ROOT is absent',
    );
  });

  // ── 4. /manifest route also returns 404 when STATIC_ROOT is absent ────────

  test('GET /manifest with expo-platform: ios returns HTTP 404 when STATIC_ROOT does not exist', async () => {
    const res = await get(`${BASE_PATH}/manifest`, { 'expo-platform': 'ios' });

    assert.equal(
      res.status,
      404,
      'expected HTTP 404 for iOS /manifest when STATIC_ROOT is absent',
    );
  });

  test('GET /manifest with expo-platform: android returns HTTP 404 when STATIC_ROOT does not exist', async () => {
    const res = await get(`${BASE_PATH}/manifest`, { 'expo-platform': 'android' });

    assert.equal(
      res.status,
      404,
      'expected HTTP 404 for Android /manifest when STATIC_ROOT is absent',
    );
  });
});

// ── Empty STATIC_ROOT suite ──────────────────────────────────────────────────
// Covers the second null-return path in scanForWebBundlePath(): the directory
// exists but contains no timestamped subdirectories with a bundle.js.

describe('serve.js — empty STATIC_ROOT (directory exists, no build output)', () => {
  /** @type {import('node:child_process').ChildProcess} */
  let serverProcess;
  let port;
  /** @type {string} */
  let emptyRoot;

  before(async () => {
    // Create the directory so existsSync returns true, but leave it empty —
    // scanForWebBundlePath() will find no timestamped dirs and return null.
    emptyRoot = mkdtempSync(join(tmpdir(), 'uc-serve-emptyroot-'));

    port = await findFreePort();
    serverProcess = spawn(process.execPath, [SERVE_JS], {
      env: {
        ...process.env,
        PORT: String(port),
        BASE_PATH,
        STATIC_ROOT: emptyRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderrChunks = [];
    serverProcess.stderr.on('data', (d) => stderrChunks.push(d));
    serverProcess.on('exit', (code) => {
      if (code && code !== 0) {
        process.stderr.write(Buffer.concat(stderrChunks));
      }
    });

    await waitForReady(port);
  });

  after(() => {
    serverProcess?.kill();
    if (emptyRoot) rmSync(emptyRoot, { recursive: true, force: true });
  });

  /** Convenience wrapper that always targets the empty-root server. */
  function get(urlPath, headers = {}) {
    return fetch(`http://127.0.0.1:${port}${urlPath}`, { headers });
  }

  // ── 1. Root path returns the landing page (no bundle script tag) ──────────

  test('GET / returns HTTP 200 with a landing page and no <script src="…bundle.js"> when STATIC_ROOT is empty', async () => {
    const res = await get(`${BASE_PATH}/`);

    assert.equal(
      res.status,
      200,
      'expected HTTP 200 for landing page even when STATIC_ROOT has no build output',
    );
    assert.match(
      res.headers.get('content-type') ?? '',
      /text\/html/,
      'expected text/html content-type for landing page',
    );

    const html = await res.text();

    // The landing page may include its own <script> tags (e.g. QR-code library),
    // but must NOT contain a <script src="…bundle.js"> injected by serveWebApp().
    const bundleSrcMatch = html.match(/<script\b[^>]*\bsrc="([^"]*bundle\.js[^"]*)"[^>]*>/);
    assert.equal(
      bundleSrcMatch,
      null,
      'landing page must not contain a <script src="…bundle.js"> tag when STATIC_ROOT has no build output',
    );
  });

  // ── 2. Health-check is unaffected by the empty directory ─────────────────

  test('GET /status returns "ok" when STATIC_ROOT exists but has no build output', async () => {
    const res = await get(`${BASE_PATH}/status`);

    assert.equal(res.status, 200, 'expected HTTP 200 for /status');
    const body = await res.text();
    assert.equal(body, 'ok', 'expected body to be "ok"');
  });
});
