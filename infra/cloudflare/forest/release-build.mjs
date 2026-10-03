/**
 * Publish only the frozen live-baseline + Hydrate integration.
 * Never build unrelated working-tree app changes into this release.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const stage = resolve(root, '.hydrate-release');
const manifest = JSON.parse(await readFile(resolve(here, 'release-manifest.json'), 'utf8'));
const archive = resolve(here, 'release-sources.tar.gz');
const actualHash = createHash('sha256').update(await readFile(archive)).digest('hex');
if (actualHash !== manifest.sourceArchiveSha256) throw new Error('Release source archive checksum mismatch');
const mode = process.argv[2];
const packages = {
  api: '@workspace/api-server',
  companion: '@workspace/uc-companion',
  hub: '@workspace/projecthub',
};
if (!packages[mode] && mode !== 'serve-companion') throw new Error('Expected api, companion, hub or serve-companion');

function run(command, args, cwd = stage, env = process.env) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    const stop = signal => child.kill(signal);
    const sigterm = () => stop('SIGTERM');
    const sigint = () => stop('SIGINT');
    process.once('SIGTERM', sigterm);
    process.once('SIGINT', sigint);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGTERM', sigterm);
      process.removeListener('SIGINT', sigint);
      if (code === 0) done();
      else reject(new Error(`${command} failed (${signal || code})`));
    });
  });
}

const marker = resolve(stage, '.prepared');
if (mode === 'serve-companion') {
  if ((await readFile(marker, 'utf8')).trim() !== actualHash) throw new Error('Isolated Companion release was not built');
  await run('node', ['server/serve.js'], resolve(stage, 'artifacts/uc-companion'));
} else {
  const response = await fetch('https://app.ucfilters.com/version.json', {
    cache: 'no-store', headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Cannot verify live release baseline; refusing to overwrite live services');
  const live = await response.json();
   const approvedLiveRevisions = [
     manifest.liveBaseRevision, manifest.integrationRevision, manifest.previousIntegrationRevision,
   ].filter(Boolean);
   if (!approvedLiveRevisions.includes(live.revision)) {
    throw new Error('Live release changed. Reconcile the frozen package before publishing.');
  }

  await mkdir(dirname(stage), { recursive: true });
  const lock = `${stage}.lock`;
  const deadline = Date.now() + 15 * 60_000;
  let acquired = false;
  while (!acquired && Date.now() < deadline) {
    try { await mkdir(lock); acquired = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(done => setTimeout(done, 500));
    }
  }
  if (!acquired) throw new Error('Timed out waiting for isolated release preparation');
  try {
    const prepared = await readFile(marker, 'utf8').catch(() => '');
    if (prepared.trim() !== actualHash) {
      // Only disposable generated staging files, never working-tree source/data.
      await rm(stage, { recursive: true, force: true });
      await mkdir(stage, { recursive: true });
      await run('tar', ['-xzf', archive, '-C', stage], root);
      await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], stage, {
        ...process.env, CI: '1',
      });
      await writeFile(marker, actualHash);
    }
  } finally { await rm(lock, { recursive: true, force: true }); }

  const env = {
    ...process.env, NODE_ENV: 'production',
    GITHUB_SHA: manifest.integrationRevision,
    SOURCE_REVISION: manifest.integrationRevision,
    EXPO_PUBLIC_FOREST_URL: manifest.forestUrl,
  };
  if (mode === 'hub') {
    env.PORT ||= '20100';
    env.BASE_PATH = '/';
  }
  if (mode === 'companion') {
    env.EXPO_PUBLIC_DOMAIN = 'app.ucfilters.com';
    env.EXPO_PUBLIC_API_DOMAIN = 'api.ucfilters.com';
    env.BASE_PATH = '/uc-companion/';
    env.METRO_PORT = '0';
    env.CLERK_PROXY_URL = '/api/__clerk';
  }
  await run('pnpm', ['--filter', packages[mode], 'run', 'build'], stage, env);
  if (mode === 'api' || mode === 'hub') {
    const dir = mode === 'api' ? 'api-server' : 'projecthub';
    const output = resolve(stage, `artifacts/${dir}/dist`);
    if (!(await stat(output)).isDirectory()) throw new Error('Release build produced no output');
    const target = resolve(root, `artifacts/${dir}/dist`);
    await rm(target, { recursive: true, force: true });
    await cp(output, target, { recursive: true });
  }
  console.log(`Isolated ${mode} release built; baseline ${manifest.liveBaseRevision}`);
}