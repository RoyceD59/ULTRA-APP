import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const origin = 'https://app.ucfilters.com';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Read-only capture. Never execute bundles or substitute another version's bytes. */
export async function captureLiveClient(destination, expectedBuildId) {
  const fetched = [];
  async function request(url, headers = {}) {
    let response;
    for (let hops = 0; hops < 4; hops++) {
      response = await fetch(url, { headers, cache: 'no-store', redirect: 'manual',
        signal: AbortSignal.timeout(30000) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const next = new URL(response.headers.get('location'), url);
      assert.equal(next.origin, origin, 'Rollback redirect leaves the approved host');
      assert.ok(next.pathname === '/version.json'
        || /^\/uc-companion(?:\/|$)/.test(next.pathname)
        || (headers['expo-platform'] && next.pathname === '/'),
      'Rollback redirect leaves the artifact');
      await response.body?.cancel();
      url = next.href;
    }
    if (!response.ok) throw new Error(`Rollback capture unavailable: ${url} (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 0, 'Empty rollback response');
    fetched.push({ url, sha256: sha(bytes), size: bytes.length });
    return bytes;
  }
  const version = JSON.parse((await request(origin + '/version.json')).toString());
  assert.equal(version.buildId, expectedBuildId, 'Live client changed during capture');
  assert.match(expectedBuildId, /^\d+-\d+$/);
  assert.equal(version.production, true);
  assert.equal(version.apiOrigin, 'https://api.ucfilters.com');
  assert.equal(version.supported.web, expectedBuildId);
  assert.equal(version.supported.expoGo, expectedBuildId);
  const base = `${origin}/uc-companion/${expectedBuildId}/`;
  const files = new Map();
  const assets = new Set();
  for (const platform of ['ios', 'android', 'web']) {
    const relative = `${expectedBuildId}/_expo/static/js/${platform}/bundle.js`;
    const bytes = await request(`${origin}/uc-companion/${relative}`);
    assert.ok(bytes.length > 1000000, 'Not a production bundle');
    files.set(relative, bytes);
    const text = bytes.toString();
    for (const match of text.matchAll(/httpServerLocation:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g)) {
      assets.add(`${match[1].replace(/\/$/, '')}/${match[2]}.${match[3]}`);
    }
    for (const match of text.matchAll(/["'](https:\/\/app\.ucfilters\.com\/uc-companion\/[^"'\\]+\/_expo\/static\/js\/[^"'\\]+)["']/g)) {
      if (/\.[a-z0-9]+(?:\?|$)/i.test(match[1])) assets.add(match[1]);
    }
    if (platform !== 'web') {
      const raw = await request(origin + '/uc-companion/', {
        'expo-platform': platform, 'expo-protocol-version': '0', accept: 'application/json',
      });
      const manifest = JSON.parse(raw.toString());
      assert.equal(manifest.launchAsset.key, `bundle-${expectedBuildId}`);
      assert.equal(manifest.launchAsset.url, base + `_expo/static/js/${platform}/bundle.js`);
      files.set(`${expectedBuildId}/${platform}/manifest.json`, raw);
      for (const asset of manifest.assets ?? []) if (asset.url) assets.add(asset.url);
    }
  }
  for (const value of assets) {
    const url = new URL(value);
    assert.ok(url.href.startsWith(base), 'Asset escapes captured client release');
    const relative = decodeURIComponent(url.pathname.slice('/uc-companion/'.length));
    assert.ok(!relative.split('/').includes('..') && !relative.includes('\\'));
    files.set(relative, await request(url.href));
  }
  // Metadata comes from the served version response, not a guessed local build.
  files.set(`${expectedBuildId}/build-info.json`, Buffer.from(JSON.stringify(version, null, 2) + '\n'));
  const after = JSON.parse((await request(origin + '/version.json')).toString());
  assert.equal(after.buildId, expectedBuildId, 'Live client changed during capture');
  // Check every collision before writing, preserving prior captured releases.
  for (const [name, bytes] of files) {
    const existing = await readFile(resolve(destination, name)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing) assert.ok(existing.equals(bytes), 'Conflicting rollback byte: ' + name);
  }
  for (const [name, bytes] of files) {
    const path = resolve(destination, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      assert.ok((await readFile(path)).equals(bytes), 'Rollback collision changed during capture: ' + name);
    });
  }
  const evidence = { buildId: expectedBuildId, capturedAt: new Date().toISOString(),
    metadataSource: origin + '/version.json', responses: fetched };
  await writeFile(resolve(destination, expectedBuildId + '-capture.json'), JSON.stringify(evidence, null, 2) + '\n');
  return { buildId: expectedBuildId, capturedFiles: files.size, assetCount: assets.size };
}
