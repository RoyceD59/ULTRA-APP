/**
 * Deployment-only post-build cleanup. Keep source archives, compiled output,
 * static/rollback assets and root runtime dependencies. Never run this as a
 * development preinstall hook.
 */
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const checksum = /^[a-f0-9]{64}$/;
async function inspect(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directory(path) {
  const info = await inspect(path);
  if (info && (!info.isDirectory() || info.isSymbolicLink())) {
    throw new Error(`Refusing cleanup through a non-directory or symlink: ${path}`);
  }
  return !!info;
}

export async function cleanupBuildDependencies(root) {
  root = resolve(root);
  await directory(root);
  const stages = [];
  const legacy = resolve(root, '.hydrate-release');
  if (await directory(legacy)) stages.push({ path: legacy });
  const candidates = resolve(root, '.consistency-build');
  if (await directory(candidates)) {
    for (const entry of await readdir(candidates)) {
      if (!checksum.test(entry)) continue; // Not a build stage or lock directory.
      const path = resolve(candidates, entry);
      await directory(path);
      stages.push({ path, expectedChecksum: entry });
    }
  }
  // Validate every stage before deleting anything. Partial/unrecognized stages
  // fail closed rather than turning a cleanup into an arbitrary filesystem walk.
  const targets = [];
  for (const stage of stages) {
    const marker = resolve(stage.path, '.prepared');
    const markerInfo = await inspect(marker);
    if (!markerInfo?.isFile() || markerInfo.isSymbolicLink()) {
      throw new Error(`Missing ordinary preparation marker: ${stage.path}`);
    }
    const identity = (await readFile(marker, 'utf8')).trim();
    if (!checksum.test(identity) || (stage.expectedChecksum && identity !== stage.expectedChecksum)) {
      throw new Error(`Unrecognized preparation marker: ${stage.path}`);
    }
    targets.push(resolve(stage.path, 'node_modules'));
    for (const group of ['artifacts', 'lib']) {
      const parent = resolve(stage.path, group);
      if (!await directory(parent)) continue;
      for (const entry of await readdir(parent)) {
        const packagePath = resolve(parent, entry);
        const info = await inspect(packagePath);
        if (info?.isSymbolicLink()) throw new Error(`Symlinked workspace package: ${packagePath}`);
        if (info?.isDirectory()) targets.push(resolve(packagePath, 'node_modules'));
      }
    }
  }
  const removed = [];
  for (const target of targets) {
    if (!await inspect(target)) continue;
    // rm unlinks a node_modules symlink without following its external target.
    // No recursive search: bundled static assets can contain node_modules paths.
    await rm(target, { recursive: true, force: true });
    removed.push(target.slice(root.length + 1));
  }
  return { removed, preserved: ['root node_modules', 'compiled outputs', 'static assets', 'source archives', 'rollback assets'] };
}

function pruneStore(root) {
  return new Promise((done, reject) => {
    const child = spawn('pnpm', ['store', 'prune'], {
      cwd: root, stdio: 'inherit', env: { ...process.env, CI: 'true' },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(
      new Error(`pnpm store prune failed (${signal || code})`),
    ));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--post-build' || process.argv.length !== 3) {
    throw new Error('Only invoke with --post-build after all artifact builds complete');
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  console.log('Deployment dependency cleanup:', JSON.stringify(await cleanupBuildDependencies(root)));
  await pruneStore(root); // Preserve the previous post-build store-prune step.
}
