/**
 * Main-workspace handoff builder. No publication, database calls, configuration
 * changes, whole-workspace builds, or removal of retained release directories.
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { APPROVED_CANDIDATE, SOURCE_IDENTITY, archive, stage, root, verifyHandoff, verifyLiveApi, retainRollback } from './consistency-handoff.mjs';
import { here } from './consistency-handoff.mjs';
import { AUTH_UPLOAD_CANDIDATE, DEPENDENCY_CANDIDATE } from './auth-upload-security.mjs';
import { verifyMainSecurityRuntimePins } from './security-dependency-selection.mjs';

const [mode, ...flags] = process.argv.slice(2);
const packages = { api: '@workspace/api-server', hub: '@workspace/projecthub', companion: '@workspace/uc-companion' };
if (!packages[mode] && mode !== 'serve-companion') throw new Error('Expected api, hub, companion or serve-companion');
if (flags.some(flag => !['--local-only', '--copy-output'].includes(flag) && !flag.startsWith('--retain-static='))) throw new Error('Unknown build flag');
const localOnly = flags.includes('--local-only');
const copyOutput = flags.includes('--copy-output');
const retentionFlags = flags.filter(flag => flag.startsWith('--retain-static='));
if (retentionFlags.length > 1 || (retentionFlags.length && mode !== 'companion')) throw new Error('Retention input is only for one Companion build');
const retainedStatic = retentionFlags[0]?.slice('--retain-static='.length);
if (mode === 'companion' && !localOnly && !retainedStatic) {
  throw new Error('Client publication preparation requires --retain-static=<complete verified predecessor directory>');
}
if (copyOutput && (localOnly || !['api', 'hub'].includes(mode))) {
  throw new Error('--copy-output is only for approved main-workspace API/Hub deployment builds');
}
await verifyHandoff();
if (mode === 'api') await verifyMainSecurityRuntimePins();
// Serving already-approved static bytes must work through API outages. External
// checks belong to deployment preparation, never process startup/restart.
if (!localOnly && mode !== 'serve-companion') {
  const frozen = JSON.parse(await readFile(resolve(here, 'release-manifest.json'), 'utf8'));
  const response = await fetch('https://app.ucfilters.com/version.json', {
    cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Cannot verify live source baseline');
  const live = await response.json();
  if (![frozen.liveBaseRevision, frozen.integrationRevision,
    frozen.previousIntegrationRevision, `consistency-${DEPENDENCY_CANDIDATE}`,
    `consistency-${AUTH_UPLOAD_CANDIDATE}`, SOURCE_IDENTITY].filter(Boolean).includes(live.revision)) {
    throw new Error('Live source baseline changed; reconcile before preparing deployment outputs');
  }
}
const marker = resolve(stage, '.prepared');
const companion = resolve(stage, 'artifacts/uc-companion');
const inheritedEnv = {
  ...process.env, NODE_ENV: 'production', GITHUB_SHA: SOURCE_IDENTITY,
  SOURCE_REVISION: SOURCE_IDENTITY,
  EXPO_PUBLIC_FOREST_URL: 'https://uc-hydrate-forest.pages.dev/',
};
function run(command, args, cwd = stage, env = inheritedEnv) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
      code === 0 ? done() : reject(new Error(`${command} failed (${signal || code})`));
    });
  });
}
// The client gate deliberately rejects the current old-API zero fallback.
if (!localOnly && ['hub', 'companion'].includes(mode)) {
  console.log('Verified live API snapshots:', JSON.stringify(await verifyLiveApi()));
}
if (mode === 'serve-companion') {
  if ((await readFile(marker, 'utf8')).trim() !== APPROVED_CANDIDATE) throw new Error('Approved source was not prepared');
  const built = JSON.parse(await readFile(resolve(stage, 'companion-build.json'), 'utf8'));
  if (built.sourceSha256 !== APPROVED_CANDIDATE || (!localOnly && built.localOnly)) {
    throw new Error('Local-only verification output cannot be used as a published client');
  }
  await run('node', ['server/serve.js'], companion, {
    ...inheritedEnv, STATIC_ROOT: resolve(companion, 'static-build'),
  });
} else {
  // Build services can run in parallel. A checksum-specific stage is never
  // deleted: unrelated packages and rollback assets stay at their existing paths.
  await mkdir(stage, { recursive: true });
  const lock = resolve(root, '.consistency-build', `${APPROVED_CANDIDATE}.lock`);
  let held = false;
  for (let attempt = 0; attempt < 1800 && !held; attempt++) {
    try { await mkdir(lock); held = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(done => setTimeout(done, 500));
    }
  }
  if (!held) throw new Error('Preparation lock still held; do not remove it while another builder is running');
  try {
    const prepared = await readFile(marker, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    if (prepared.trim() !== APPROVED_CANDIDATE) {
      // Refuse to overwrite an incomplete prior extraction.
      if ((await readdir(stage)).length) throw new Error('Stage is nonempty without a valid marker; investigate before rebuilding');
      await run('tar', ['-xzf', archive, '-C', stage], root);
      await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], stage, { ...inheritedEnv, CI: '1' });
      await run('pnpm', ['run', 'typecheck:libs']);
      await writeFile(marker, `${APPROVED_CANDIDATE}\n`);
    }
  } finally {
    // Only the empty lock directory, never archives or build assets.
    const { rmdir } = await import('node:fs/promises');
    await rmdir(lock);
  }
  // A patch hash or cached installation is not proof the backport is active.
  // Exercise the actual frozen consumers before any deployment output is copied.
  await run('node', ['--test', 'scripts/tests/dependency-security.test.mjs']);
  await run('node', ['--test', resolve(here, 'consistency-security-runtime.test.mjs')]);
  // These exact merged fixtures never query/mutate a database or reach storage.
  // DB-backed access/upload fixtures are validated separately in disposable test
  // databases during local preparation, not in a production deployment build.
  await run('node', ['--import', 'tsx/esm', '--test', '--test-force-exit',
    '--test-concurrency=1',
    'src/tests/{jwt-session-expiry,review-media-signature,storage-public-media-security}.test.ts'],
  resolve(stage, 'artifacts/api-server'), { ...inheritedEnv, NODE_ENV: 'test', GOMAXPROCS: '2' });
  await run('pnpm', ['--filter', packages[mode], 'run', 'typecheck']);
  const env = { ...inheritedEnv };
  if (mode === 'hub') { env.PORT ||= '20100'; env.BASE_PATH = '/'; }
  if (mode === 'companion') {
    env.EXPO_PUBLIC_DOMAIN = 'app.ucfilters.com';
    env.EXPO_PUBLIC_API_DOMAIN = 'api.ucfilters.com';
    env.BASE_PATH = '/uc-companion/';
    env.METRO_PORT = '0';
    env.CLERK_PROXY_URL = '/api/__clerk';
    if (retainedStatic) {
      const response = await fetch('https://app.ucfilters.com/version.json', {
        cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Cannot verify the actually served rollback build');
      const current = await response.json();
      console.log('Retained rollback:', JSON.stringify(await retainRollback(
        resolve(root, retainedStatic), resolve(companion, 'static-build'), current.buildId,
      )));
    }
  }
  await run('pnpm', ['--filter', packages[mode], 'run', 'build'], stage, env);
  if (mode === 'companion') {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { readActiveBuild } = require(resolve(companion, 'scripts/active-static-build.cjs'));
    const buildId = readActiveBuild(resolve(companion, 'static-build'));
    const info = JSON.parse(await readFile(resolve(companion, 'static-build', buildId, 'build-info.json'), 'utf8'));
    if (info.revision !== SOURCE_IDENTITY || info.apiOrigin !== 'https://api.ucfilters.com') {
      throw new Error('Compiled client identity or API origin mismatch');
    }
    await writeFile(resolve(stage, 'companion-build.json'), JSON.stringify({
      sourceSha256: APPROVED_CANDIDATE, buildId, localOnly,
      status: 'compiled-not-published', apiOrigin: info.apiOrigin,
    }, null, 2) + '\n');
  }
  if (copyOutput) {
    const dir = mode === 'api' ? 'api-server' : 'projecthub';
    const output = resolve(stage, `artifacts/${dir}/dist`);
    if (!(await stat(output)).isDirectory()) throw new Error('No compiled output');
    // Merge rather than delete; old hashed frontend assets remain reachable.
    await cp(output, resolve(root, `artifacts/${dir}/dist`), { recursive: true });
  }
  console.log(`Approved ${mode} candidate compiled; ${localOnly ? 'local-only verification' : 'deployment preparation'}; NOT PUBLISHED.`);
}
