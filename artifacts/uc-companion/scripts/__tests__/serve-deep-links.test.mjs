import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const serverFile = resolve(testDir, '../../server/serve.js');

async function openPort() {
  const listener = net.createServer();
  await new Promise(resolveReady => listener.listen(0, '127.0.0.1', resolveReady));
  const port = listener.address().port;
  await new Promise(resolveClose => listener.close(resolveClose));
  return port;
}

test('production Companion server resolves deep links without an HTML Accept header', async () => {
  const tempRoot = resolve(mkdtempSync(join(tmpdir(), 'uc-companion-routes-')));
  const tmpRoot = resolve(tmpdir());
  assert.ok(tempRoot.startsWith(`${tmpRoot}${sep}`), 'test fixture must remain inside the temporary directory');
  const bundlePath = join(tempRoot, '2026-10-02', '_expo', 'static', 'js', 'web', 'bundle.js');
  mkdirSync(dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, 'console.log("preview fixture")');
  const port = await openPort();
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: String(port), BASE_PATH: '/uc-companion', STATIC_ROOT: tempRoot },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/uc-companion/status`);
        if (response.ok) { ready = true; break; }
      } catch { /* server still starting */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    assert.ok(ready, 'fixture server did not start');
    for (const route of ['products', 'blog', 'support', 'map', 'account']) {
      const response = await fetch(`http://127.0.0.1:${port}/uc-companion/${route}`, { headers: { Accept: '*/*' } });
      assert.equal(response.status, 200, route);
      assert.match(await response.text(), /bundle\.js/);
    }
    const missingAsset = await fetch(`http://127.0.0.1:${port}/uc-companion/missing.js`, { headers: { Accept: '*/*' } });
    assert.equal(missingAsset.status, 404);
    const missingRoute = await fetch(`http://127.0.0.1:${port}/uc-companion/not-a-route`, { headers: { Accept: '*/*' } });
    assert.equal(missingRoute.status, 404);
    assert.equal(missingRoute.headers.get('cache-control'), 'no-store');
  } finally {
    child.kill();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});