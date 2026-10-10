import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  cleanupBuildDependencies, reportDeploymentImage, formatImageReport,
  resolveImageLimit, DEFAULT_IMAGE_WARN_BYTES,
} from '../prepare-deployment-image.mjs';
import { stage as actualCandidateStage } from '../../infra/cloudflare/forest/consistency-handoff.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha = 'a'.repeat(64);
async function put(root, path, value = 'keep') {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), value);
}
async function fixture(t) {
  const path = await mkdtemp(resolve(tmpdir(), 'deployment-image-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('post-build removes only marked stage dependency trees; archives and static node_modules assets survive', async t => {
  const path = await fixture(t);
  const stages = ['.hydrate-release', `.consistency-build/${sha}`];
  const survivors = [
    'node_modules/runtime/index.js', 'infra/cloudflare/forest/release-sources.tar.gz',
    'infra/cloudflare/forest/security-consistency/release-sources.tar.gz',
    'infra/cloudflare/forest/rollback-static/build/node_modules/fonts/font.ttf',
    'artifacts/api-server/data/do-not-touch.jsonl',
    '.consistency-build/unrecognized/dist/keep.js',
  ];
  for (const stage of stages) {
    await put(path, `${stage}/.prepared`, sha);
    for (const part of ['node_modules', 'artifacts/uc-companion/node_modules', 'artifacts/projecthub/node_modules', 'lib/db/node_modules']) {
      await put(path, `${stage}/${part}/dependency.js`);
    }
    survivors.push(`${stage}/.prepared`, `${stage}/artifacts/api-server/dist/index.mjs`,
      `${stage}/artifacts/uc-companion/server/serve.js`,
      `${stage}/artifacts/uc-companion/static-build/build/node_modules/fonts/font.ttf`);
  }
  for (const file of survivors.filter(file => !file.endsWith('.prepared'))) await put(path, file);
  const before = await Promise.all(survivors.map(file => readFile(resolve(path, file))));
  const result = await cleanupBuildDependencies(path);
  assert.equal(result.removed.length, 8);
  for (const deleted of result.removed) await assert.rejects(readFile(resolve(path, deleted, 'dependency.js')), { code: 'ENOENT' });
  for (let i = 0; i < survivors.length; i++) assert.deepEqual(await readFile(resolve(path, survivors[i])), before[i]);
  assert.deepEqual((await cleanupBuildDependencies(path)).removed, []);
});

test('invalid preparation marker stops before any dependency removal', async t => {
  const path = await fixture(t);
  await put(path, '.hydrate-release/.prepared', sha);
  await put(path, '.hydrate-release/node_modules/keep.js');
  await put(path, `.consistency-build/${sha}/.prepared`, 'b'.repeat(64));
  await assert.rejects(cleanupBuildDependencies(path), /Unrecognized preparation marker/);
  assert.equal(await readFile(resolve(path, '.hydrate-release/node_modules/keep.js'), 'utf8'), 'keep');
});

test('unmarked hash-named folder is scratch: no abort, dependencies removed, everything else kept', async t => {
  const path = await fixture(t);
  const unmarked = `.consistency-build/${'c'.repeat(64)}`;
  await put(path, `.consistency-build/${sha}/.prepared`, sha);
  await put(path, `.consistency-build/${sha}/node_modules/dependency.js`);
  for (const part of ['node_modules', 'artifacts/api-server/node_modules', 'lib/db/node_modules']) {
    await put(path, `${unmarked}/${part}/dependency.js`);
  }
  await put(path, `${unmarked}/artifacts/api-server/dist/index.mjs`);
  await put(path, `${unmarked}/package.json`);
  const result = await cleanupBuildDependencies(path);
  assert.deepEqual(result.scratch, [unmarked]);
  assert.deepEqual(result.approved, [`.consistency-build/${sha}`]);
  assert.equal(result.removed.length, 4);
  for (const part of ['node_modules', 'artifacts/api-server/node_modules', 'lib/db/node_modules']) {
    await assert.rejects(readFile(resolve(path, unmarked, part, 'dependency.js')), { code: 'ENOENT' });
  }
  assert.equal(await readFile(resolve(path, unmarked, 'artifacts/api-server/dist/index.mjs'), 'utf8'), 'keep');
  assert.equal(await readFile(resolve(path, unmarked, 'package.json'), 'utf8'), 'keep');
  const report = await reportDeploymentImage(path);
  assert.equal(report.folders.find(folder => folder.name === unmarked).status, 'scratch');
});

test('scratch folder with node_modules loses only dependency trees; static node_modules assets and the folder survive', async t => {
  const path = await fixture(t);
  const scratch = '.consistency-build/security-center-cache-cold';
  for (const part of ['node_modules', 'artifacts/uc-companion/node_modules', 'lib/db/node_modules']) {
    await put(path, `${scratch}/${part}/dependency.js`);
  }
  await put(path, `${scratch}/artifacts/uc-companion/static-build/b/node_modules/fonts/font.ttf`);
  await put(path, `${scratch}/src/keep.txt`);
  await put(path, '.consistency-build/abandoned-x/.prepared', 'not-a-checksum'); // marker names carry no approval
  await put(path, '.consistency-build/abandoned-x/node_modules/dependency.js');
  await put(path, `.consistency-build/${sha}.lock/.keep`); // lock directory is scratch with nothing to strip
  const result = await cleanupBuildDependencies(path);
  assert.equal(result.removed.length, 4);
  assert.deepEqual(result.scratch, [
    `.consistency-build/${sha}.lock`, '.consistency-build/abandoned-x', scratch,
  ]);
  assert.equal(await readFile(resolve(path, scratch, 'artifacts/uc-companion/static-build/b/node_modules/fonts/font.ttf'), 'utf8'), 'keep');
  assert.equal(await readFile(resolve(path, scratch, 'src/keep.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(resolve(path, `.consistency-build/${sha}.lock/.keep`), 'utf8'), 'keep');
  assert.deepEqual((await cleanupBuildDependencies(path)).removed, []);
});

test('a wrong marker still fails closed and leaves scratch dependencies untouched', async t => {
  const path = await fixture(t);
  await put(path, `.consistency-build/${sha}/.prepared`, 'b'.repeat(64));
  await put(path, '.consistency-build/scratch/node_modules/keep.js');
  await put(path, `.consistency-build/${'d'.repeat(64)}/node_modules/keep.js`);
  await assert.rejects(cleanupBuildDependencies(path), /Unrecognized preparation marker/);
  assert.equal(await readFile(resolve(path, '.consistency-build/scratch/node_modules/keep.js'), 'utf8'), 'keep');
  assert.equal(await readFile(resolve(path, `.consistency-build/${'d'.repeat(64)}/node_modules/keep.js`), 'utf8'), 'keep');
  const report = await reportDeploymentImage(path);
  assert.equal(report.folders.find(folder => folder.name.endsWith(sha)).status, 'invalid-marker');
  // The legacy stage keeps its strict rule: it must carry a marker.
  const legacy = await fixture(t);
  await put(legacy, '.hydrate-release/node_modules/keep.js');
  await assert.rejects(cleanupBuildDependencies(legacy), /Missing ordinary preparation marker/);
});

test('scratch folder symlinks and symlinked scratch workspace packages fail closed without following targets', async t => {
  const path = await fixture(t);
  const outside = await fixture(t);
  await put(outside, 'node_modules/keep.js');
  await mkdir(resolve(path, '.consistency-build'), { recursive: true });
  await symlink(outside, resolve(path, '.consistency-build/linked'));
  await assert.rejects(cleanupBuildDependencies(path), /symlink/);
  await rm(resolve(path, '.consistency-build/linked'));
  await mkdir(resolve(path, '.consistency-build/scratch/artifacts'), { recursive: true });
  await symlink(outside, resolve(path, '.consistency-build/scratch/artifacts/uc-companion'));
  await assert.rejects(cleanupBuildDependencies(path), /Symlinked workspace package/);
  assert.equal(await readFile(resolve(outside, 'node_modules/keep.js'), 'utf8'), 'keep');
});

test('pre-upload summary reports each folder status and size, totals the image, and warns over the limit', async t => {
  const path = await fixture(t);
  const scratch = '.consistency-build/scratch-stage';
  await put(path, `.consistency-build/${sha}/.prepared`, sha);
  await put(path, `.consistency-build/${sha}/artifacts/api-server/dist/index.mjs`, 'x'.repeat(2000));
  await put(path, `${scratch}/src/a.txt`, 'y'.repeat(1000));
  await put(path, '.consistency-build/stray-file.txt', 'ignored: not a folder');
  await put(path, 'node_modules/runtime/index.js', 'z'.repeat(500));
  await put(path, '.local/big.bin', 'q'.repeat(10_000));
  await put(path, '.git/objects/pack', 'g'.repeat(10_000));
  await put(path, '.replitignore', '# comment\n.local\n.cache/\n');
  const ignoreSize = (await readFile(resolve(path, '.replitignore'))).length;
  await cleanupBuildDependencies(path);
  const report = await reportDeploymentImage(path, { limitBytes: 100_000 });
  assert.deepEqual(report.folders.map(({ name, status, bytes }) => ({ name, status, bytes })), [
    { name: `.consistency-build/${sha}`, status: 'approved', bytes: 2000 + 64 },
    { name: scratch, status: 'scratch', bytes: 1000 },
  ]);
  // Ignored top-level names and .git are excluded; stray files still ship.
  assert.equal(report.totalBytes, 2064 + 1000 + 'ignored: not a folder'.length + 500 + ignoreSize);
  assert.equal(report.overLimit, false);
  assert.ok(!formatImageReport(report).join('\n').includes('WARNING'));
  const text = formatImageReport(await reportDeploymentImage(path, { limitBytes: 1000 })).join('\n');
  assert.match(text, /!!! WARNING: image content is over/);
  assert.match(text, new RegExp(`${scratch}\\s+scratch\\s`));
  assert.match(text, new RegExp(`${sha}\\s+approved\\s`));
});

test('image warning limit defaults near the real limit and an environment override must be valid', () => {
  assert.equal(resolveImageLimit({}), DEFAULT_IMAGE_WARN_BYTES);
  assert.ok(DEFAULT_IMAGE_WARN_BYTES > 6 * 1024 ** 3 && DEFAULT_IMAGE_WARN_BYTES < 8 * 1024 ** 3);
  assert.equal(resolveImageLimit({ DEPLOYMENT_IMAGE_WARN_BYTES: '12345' }), 12345);
  for (const bad of ['0', '-1', '1.5', 'big']) {
    assert.throws(() => resolveImageLimit({ DEPLOYMENT_IMAGE_WARN_BYTES: bad }), /positive whole number/);
  }
});

test('stage or workspace symlinks fail closed; dependency symlinks are unlinked without following targets', async t => {
  const path = await fixture(t);
  const outside = await fixture(t);
  await put(outside, 'keep.js');
  await symlink(outside, resolve(path, '.hydrate-release'));
  await assert.rejects(cleanupBuildDependencies(path), /symlink/);
  await rm(resolve(path, '.hydrate-release'));
  await put(path, '.hydrate-release/.prepared', sha);
  await symlink(outside, resolve(path, '.hydrate-release/node_modules'));
  await cleanupBuildDependencies(path);
  assert.equal(await readFile(resolve(outside, 'keep.js'), 'utf8'), 'keep');
  await mkdir(resolve(path, '.hydrate-release/artifacts'), { recursive: true });
  await symlink(outside, resolve(path, '.hydrate-release/artifacts/uc-companion'));
  await assert.rejects(cleanupBuildDependencies(path), /Symlinked workspace package/);
});

test('deployment hook runs cleanup after compilation and retains store pruning and API-first selection', async () => {
  const config = await readFile(resolve(root, '.replit'), 'utf8');
  assert.match(config, /\[deployment\.postBuild\]\s*args = \["node", "scripts\/prepare-deployment-image\.mjs", "--post-build"\]/);
  const ignores = await readFile(resolve(root, '.replitignore'), 'utf8');
  assert.match(ignores, /^\.cache\/$/m);
  assert.doesNotMatch(ignores, /^\.consistency-build\/$/m);
  assert.doesNotMatch(ignores, /^\.hydrate-release(?:\/|\s*$)/m);
  const api = await readFile(resolve(root, 'artifacts/api-server/.replit-artifact/artifact.toml'), 'utf8');
  const client = await readFile(resolve(root, 'artifacts/uc-companion/.replit-artifact/artifact.toml'), 'utf8');
  assert.match(api, /build-approved-consistency\.mjs", "api", "--copy-output"/);
  assert.match(client, /release-build\.mjs", "companion"/);
  assert.doesNotMatch(client, /build-approved-consistency\.mjs/);
});

test('actual frozen Companion core-Node server still serves browser and native metadata after cleanup', async t => {
  const path = await fixture(t);
  const stage = '.hydrate-release';
  const app = resolve(path, stage, 'artifacts/uc-companion');
  await put(path, `${stage}/.prepared`, sha);
  // Use exact archived server bytes, not a mock or current working-tree server.
  await cp(resolve(root, '.hydrate-release/artifacts/uc-companion/server'), resolve(app, 'server'), { recursive: true });
  await cp(resolve(root, '.hydrate-release/artifacts/uc-companion/scripts'), resolve(app, 'scripts'), { recursive: true });
  await cp(resolve(root, '.hydrate-release/artifacts/uc-companion/app.json'), resolve(app, 'app.json'));
  await put(path, `${stage}/node_modules/build-only/index.js`);
  await put(path, `${stage}/artifacts/uc-companion/static-build/ios/manifest.json`,
    JSON.stringify({ launchAsset: { key: 'bundle-test', url: 'https://example.invalid/bundle.js' } }));
  await put(path, `${stage}/artifacts/uc-companion/static-build/test/_expo/static/js/web/bundle.js`, 'console.log("test");');
  await put(path, `${stage}/artifacts/uc-companion/static-build/test/build-info.json`, '{"buildId":"test"}');
  await cleanupBuildDependencies(path);
  const reservation = createServer();
  await new Promise(done => reservation.listen(0, '127.0.0.1', done));
  const reservedPort = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const child = spawn(process.execPath, ['server/serve.js'], {
    cwd: app, env: { ...process.env, PORT: String(reservedPort), BASE_PATH: '/uc-companion/' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  let output = '';
  const port = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 8000);
    child.stdout.on('data', bytes => {
      output += bytes;
      const match = output.match(/(?:port|:)\s*(\d{4,5})/i);
      if (match) { clearTimeout(timer); done(Number(match[1])); }
    });
    child.stderr.on('data', bytes => { output += bytes; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${output}`)); });
  });
  const base = `http://127.0.0.1:${port}/uc-companion`;
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/version.json`)).status, 200);
  const manifest = await fetch(`${base}/`, { headers: { 'expo-platform': 'ios' } });
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json()).launchAsset.key, 'bundle-test');
});

test('frozen API logging workers retain their compiled paths and use preserved root runtime dependencies', async t => {
  const path = await fixture(t);
  const candidate = `.consistency-build/${sha}`;
  const dist = resolve(path, candidate, 'artifacts/api-server/dist');
  const sourceDist = resolve(actualCandidateStage, 'artifacts/api-server/dist');
  await put(path, `${candidate}/.prepared`, sha);
  await put(path, `${candidate}/node_modules/build-only/index.js`);
  await symlink(resolve(root, 'node_modules'), resolve(path, 'node_modules'));
  for (const file of ['pino-worker.mjs', 'pino-file.mjs', 'pino-pretty.mjs', 'thread-stream-worker.mjs']) {
    const text = await readFile(resolve(sourceDist, file), 'utf8');
    // Normalize only the temporary fixture's baked worker location. Production
    // compiled bytes are not rewritten and their actual dist directories survive.
    await put(path, `${candidate}/artifacts/api-server/dist/${file}`,
      text.replaceAll(JSON.stringify(sourceDist), JSON.stringify(dist)));
  }
  await cleanupBuildDependencies(path);
  await put(path, 'worker-check.mjs', `
    import { createRequire } from 'node:module';
    const require = createRequire(${JSON.stringify(resolve(root, 'artifacts/api-server/package.json'))});
    globalThis.__bundlerPathsOverrides = {
      'pino-worker': ${JSON.stringify(resolve(dist, 'pino-worker.mjs'))},
      'thread-stream-worker': ${JSON.stringify(resolve(dist, 'thread-stream-worker.mjs'))}
    };
    const pino = require('pino');
    const stream = pino.transport({target: ${JSON.stringify(resolve(dist, 'pino-file.mjs'))}, options:{destination:1}});
    stream.on('error', error => { console.error(error); process.exit(1); });
    stream.on('ready', () => { pino({}, stream).info('frozen-worker-after-cleanup'); stream.end(); });
  `);
  const child = spawn(process.execPath, [resolve(path, 'worker-check.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  let output = '';
  let errors = '';
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error(`Worker timed out: ${errors}`)), 8000);
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { errors += bytes; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? done() : reject(new Error(`Worker failed (${code}): ${errors}`));
    });
  });
  assert.match(output, /frozen-worker-after-cleanup/);
});
