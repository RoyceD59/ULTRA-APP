/**
 * Installed-backport verification for frozen release stages.
 *
 * A hash-qualified pnpm directory name, a successful frozen install and a
 * populated preparation marker are NOT evidence that a declared patch is active:
 * a plain frozen install reports "Already up to date" and trusts any existing
 * directory with the expected name. This module therefore inspects the installed
 * bytes, resolves them through the real consuming packages, and runs the
 * attack/ordinary-behaviour fixtures. It never edits an installation.
 *
 * Library use:   import { verifyInstalledBackports } from './security-patch-installation.mjs'
 * Stage check:   node security-patch-installation.mjs verify --stage DIR
 * Reproduction:  node security-patch-installation.mjs reproduce --archive TGZ \
 *                  --sha256 HEX --report OUT.json [--work DIR]
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKPORTS = {
  braces: {
    consumer: ['api-server', ['http-proxy-middleware', 'micromatch', 'braces']],
    files: {
      'lib/parse.js': /nesting depth/,
      'lib/compile.js': /nesting depth/,
      'lib/expand.js': /nesting depth/,
      'lib/stringify.js': /nesting depth/,
    },
  },
  'http-cache-semantics': {
    consumer: ['uc-companion', ['@expo/ngrok', 'got', 'cacheable-request', 'http-cache-semantics']],
    files: { 'index.js': /max-stale must not revive/ },
  },
  'node-forge': {
    consumer: ['uc-companion', ['expo', '@expo/cli', 'node-forge']],
    files: { 'lib/rsa.js': /obj\.value\[0\]\.value\.length > 2[\s\S]{0,120}capture\.parameters !== ''/ },
  },
};

/** Declared patch identities from a stage's frozen lock (name -> {version, hash}). */
export function declaredPatches(lockText) {
  const section = lockText.match(/^patchedDependencies:\n((?:[ ]{2,}.*\n|\n)+?)(?=^\S)/m);
  if (!section) throw new Error('Lock declares no patchedDependencies');
  const found = {};
  for (const match of section[1].matchAll(/^ {2}'?((?:@[^@/]+\/)?[^@'\s]+)@([^:'\s]+)'?:\n {4}hash: ([0-9a-f]{64})\n {4}path: \S+/gm)) {
    found[match[1]] = { version: match[2], hash: match[3] };
  }
  return found;
}

function packageRoot(entry, name) {
  let directory = dirname(entry);
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate ${name} package root from ${entry}`);
    directory = parent;
  }
}

function inspectCopy(root, files) {
  const failures = [];
  for (const [relative, marker] of Object.entries(files)) {
    const path = join(root, relative);
    if (!existsSync(path)) failures.push(`${path}: file missing`);
    else if (!marker.test(readFileSync(path, 'utf8'))) failures.push(`${path}: declared guard is absent`);
  }
  return failures;
}

/**
 * Throws unless every declared backport is present in every installed copy and in
 * the copy that the real consumers resolve. Returns structured evidence.
 */
export function verifyInstalledBackports(stage, { runFixtures = true } = {}) {
  stage = resolve(stage);
  const declared = declaredPatches(readFileSync(join(stage, 'pnpm-lock.yaml'), 'utf8'));
  const evidence = { stage, packages: {}, fixtures: null };
  const failures = [];
  for (const [name, spec] of Object.entries(BACKPORTS)) {
    const patch = declared[name];
    if (!patch) { failures.push(`${name}: no declared patch in lock`); continue; }
    const item = { version: patch.version, patchHash: patch.hash, resolved: null, copies: [] };
    evidence.packages[name] = item;
    const expectedDirectory = `${name}@${patch.version}_patch_hash=${patch.hash}`;
    try {
      const [artifact, chain] = spec.consumer;
      let require = createRequire(join(stage, 'artifacts', artifact, 'package.json'));
      for (const hop of chain.slice(0, -1)) require = createRequire(require.resolve(hop));
      const real = packageRoot(require.resolve(chain.at(-1)), name);
      item.resolved = real.startsWith(stage) ? real.slice(stage.length + 1) : real;
      if (!real.includes(`/${expectedDirectory}/`)) failures.push(`${name}: consumer resolves ${item.resolved}, expected ${expectedDirectory}`);
      failures.push(...inspectCopy(real, spec.files));
    } catch (error) {
      failures.push(`${name}: consumer resolution failed: ${error.message}`);
    }
    const store = join(stage, 'node_modules/.pnpm');
    const copies = existsSync(store) ? readdirSync(store).filter(entry => entry.startsWith(`${name}@`)) : [];
    if (!copies.length) failures.push(`${name}: no installed virtual-store copy`);
    for (const copy of copies) {
      const problems = inspectCopy(join(store, copy, 'node_modules', name), spec.files);
      if (copy !== expectedDirectory) problems.push(`${copy}: unexpected installed copy (expected only ${expectedDirectory})`);
      item.copies.push({ directory: copy, guarded: !problems.length });
      failures.push(...problems);
    }
  }
  if (failures.length) throw new Error('Installed security backports are not active:\n- ' + failures.join('\n- '));
  if (runFixtures) {
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'scripts/tests/dependency-security.test.mjs'],
      { cwd: stage, encoding: 'utf8', env: { ...process.env, GOMAXPROCS: '2' } });
    evidence.fixtures = { status: result.status, summary: (result.stdout.match(/ℹ (tests|pass|fail) \d+/g) ?? []).join(', ') };
    if (result.error || result.status !== 0) {
      throw new Error('Installed backport behaviour fixtures failed:\n' + (result.stdout + result.stderr).slice(-3000));
    }
  }
  return evidence;
}

// ---------------------------------------------------------------- reproduction
const run = (command, args, options = {}) => {
  const started = Date.now();
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error ?? (result.stderr || result.stdout).slice(-2000)}`);
  }
  return { stdout: result.stdout.trim(), seconds: Math.round((Date.now() - started) / 1000) };
};
const INSTALL = ['install', '--frozen-lockfile', '--ignore-scripts', '--prod=false'];

async function extract(archive, destination) {
  await mkdir(destination, { recursive: true });
  run('tar', ['-xzf', archive, '-C', destination]);
}

function tamperHttpCache(stage) {
  const store = join(stage, 'node_modules/.pnpm');
  const directory = readdirSync(store).find(entry => entry.startsWith('http-cache-semantics@'));
  const path = join(store, directory, 'node_modules/http-cache-semantics/index.js');
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf('        // max-stale must not revive');
  const end = text.indexOf('        // In all circumstances, a cache MUST NOT ignore');
  if (start < 0 || end < start) throw new Error('Cannot construct the disposable inactive-patch fixture');
  unlinkSync(path); // break the hard link so the store copy is never modified
  writeFileSync(path, text.slice(0, start) + text.slice(end));
}

export async function reproduce({ archive, sha256, work, report }) {
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
  // The sealed identity is the archive's own content hash, checked before use.
  if (actual !== sha256) throw new Error(`Archive checksum mismatch: ${actual}`);
  const root = work ? resolve(work) : await mkdtemp(join(tmpdir(), 'security-patch-install-'));
  await mkdir(root, { recursive: true });
  const env = { ...process.env, CI: '1', GOMAXPROCS: '2' };
  const log = {
    archive: { path: archive, sha256: actual },
    tools: { node: process.version, pnpm: run('pnpm', ['--version']).stdout },
    runs: [],
  };
  const install = (name, stage, store, extra = [], overrides = {}) => {
    const { seconds } = run('pnpm', [...INSTALL, '--store-dir', store, ...extra], { cwd: stage, env: { ...env, ...overrides } });
    const evidence = verifyInstalledBackports(stage);
    log.runs.push({ name, command: `pnpm ${[...INSTALL, '--store-dir <isolated>', ...extra].join(' ')}`, seconds, ...overrides, ok: true, evidence });
    return evidence;
  };
  const cold = async (name, overrides) => {
    const stage = join(root, name, 'stage');
    const store = join(root, name, 'store');
    await extract(archive, stage);
    await mkdir(store, { recursive: true });
    install(name, stage, store, ['--force'], overrides);
    return { stage, store };
  };
  // The warm repeats reuse the first store before a second independent cold
  // store is created.
  const first = await cold('cold-1', {});
  const warm = join(root, 'warm-new-stage', 'stage');
  await extract(archive, warm);
  install('warm-store-fresh-modules', warm, first.store);
  install('warm-in-place-repeat', first.stage, first.store);
  // Evidence is already recorded; release the first installation so the second,
  // independent cold store stays within the workspace storage quota.
  await rm(join(root, 'warm-new-stage'), { recursive: true, force: true });
  await rm(join(root, 'cold-1'), { recursive: true, force: true });
  const victim = await cold('cold-2-production-env', { NODE_ENV: 'production' });

  // Negative evidence on a real installation: inactive patch must be rejected even
  // though the install exits 0, keeps its hash-qualified name, and a plain frozen
  // reinstall reports itself up to date.
  tamperHttpCache(victim.stage);
  const negative = { rejectedAfterTamper: false, plainFrozenReinstallStillRejected: false, forcedReinstallRestores: false };
  try { verifyInstalledBackports(victim.stage); } catch { negative.rejectedAfterTamper = true; }
  const plain = run('pnpm', [...INSTALL, '--store-dir', victim.store], { cwd: victim.stage, env });
  negative.plainFrozenOutput = plain.stdout.split('\n').filter(Boolean).slice(-2).join(' | ');
  try { verifyInstalledBackports(victim.stage); } catch { negative.plainFrozenReinstallStillRejected = true; }
  run('pnpm', [...INSTALL, '--force', '--store-dir', victim.store], { cwd: victim.stage, env });
  verifyInstalledBackports(victim.stage);
  negative.forcedReinstallRestores = true;
  log.negative = negative;
  if (!Object.values(negative).filter(value => typeof value === 'boolean').every(Boolean)) {
    throw new Error('Negative inactive-patch checks did not behave as required');
  }
  log.passed = true;
  if (report) await writeFile(report, JSON.stringify(log, null, 2) + '\n');
  return log;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const option = name => { const at = rest.indexOf(name); return at < 0 ? undefined : rest[at + 1]; };
  if (command === 'verify' && option('--stage')) {
    console.log(JSON.stringify(verifyInstalledBackports(option('--stage')), null, 2));
  } else if (command === 'reproduce' && option('--archive') && option('--sha256')) {
    const result = await reproduce({ archive: resolve(option('--archive')), sha256: option('--sha256'), work: option('--work'), report: option('--report') });
    console.log(JSON.stringify({ passed: result.passed, runs: result.runs.map(r => [r.name, r.seconds]), negative: result.negative }, null, 2));
  } else {
    throw new Error('Usage: verify --stage DIR | reproduce --archive TGZ --sha256 HEX [--work DIR] [--report FILE]');
  }
}
