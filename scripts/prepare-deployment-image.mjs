/**
 * Deployment-only post-build cleanup. Keep source archives, compiled output,
 * static/rollback assets and root runtime dependencies. Never run this as a
 * development preinstall hook.
 *
 * Folder classes under `.consistency-build/` and `.hydrate-release`:
 * - approved: a 64-hex folder whose `.prepared` marker equals its own name, or
 *   the legacy `.hydrate-release` stage with any valid marker. Strict checks.
 * - scratch: any other folder (including an unmarked 64-hex folder). Only its
 *   installed dependency trees are removed; the folder itself is kept.
 * - invalid-marker: a marker that exists but is wrong (or a legacy stage with
 *   no marker). This fails closed before anything is removed.
 */
import { lstat, readdir, readFile, realpath, readlink, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const checksum = /^[a-f0-9]{64}$/;
// The published image limit is 8 GiB; warn before reaching it.
export const DEFAULT_IMAGE_WARN_BYTES = 7 * 1024 ** 3;
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

/**
 * Classify every build folder without changing anything. Plain files and lock
 * entries are not folders and are ignored; symlinked folders fail closed.
 */
export async function classifyBuildFolders(root) {
  root = resolve(root);
  await directory(root);
  const found = [];
  const legacy = resolve(root, '.hydrate-release');
  if (await directory(legacy)) found.push({ name: '.hydrate-release', path: legacy, legacy: true });
  const candidates = resolve(root, '.consistency-build');
  if (await directory(candidates)) {
    for (const entry of (await readdir(candidates)).sort()) {
      const path = resolve(candidates, entry);
      const info = await inspect(path);
      if (info?.isSymbolicLink()) throw new Error(`Refusing cleanup through a non-directory or symlink: ${path}`);
      if (!info?.isDirectory()) continue;
      found.push({
        name: `.consistency-build/${entry}`, path, legacy: false,
        expectedChecksum: checksum.test(entry) ? entry : null,
      });
    }
  }
  for (const folder of found) {
    const strict = folder.legacy || folder.expectedChecksum;
    const markerInfo = await inspect(resolve(folder.path, '.prepared'));
    if (!strict || (!markerInfo && !folder.legacy)) {
      // Not a stage name, or a hash name that was never marked: never approved.
      folder.status = 'scratch';
    } else if (!markerInfo?.isFile() || markerInfo.isSymbolicLink()) {
      folder.status = 'invalid-marker';
      folder.error = `Missing ordinary preparation marker: ${folder.path}`;
    } else {
      const identity = (await readFile(resolve(folder.path, '.prepared'), 'utf8')).trim();
      if (!checksum.test(identity) || (folder.expectedChecksum && identity !== folder.expectedChecksum)) {
        folder.status = 'invalid-marker';
        folder.error = `Unrecognized preparation marker: ${folder.path}`;
      } else folder.status = 'approved';
    }
  }
  return found;
}

/** Bounded dependency locations: folder root, artifacts/* and lib/* only. */
async function dependencyTargets(folderPath) {
  const targets = [resolve(folderPath, 'node_modules')];
  for (const group of ['artifacts', 'lib']) {
    const parent = resolve(folderPath, group);
    if (!await directory(parent)) continue;
    for (const entry of await readdir(parent)) {
      const packagePath = resolve(parent, entry);
      const info = await inspect(packagePath);
      if (info?.isSymbolicLink()) throw new Error(`Symlinked workspace package: ${packagePath}`);
      if (info?.isDirectory()) targets.push(resolve(packagePath, 'node_modules'));
    }
  }
  return targets;
}

export async function cleanupBuildDependencies(root) {
  root = resolve(root);
  const folders = await classifyBuildFolders(root);
  // Validate every folder before deleting anything. A wrong marker or symlink
  // fails closed rather than turning a cleanup into an arbitrary filesystem walk.
  const invalid = folders.find(folder => folder.status === 'invalid-marker');
  if (invalid) throw new Error(invalid.error);
  const targets = [];
  for (const folder of folders) {
    for (const path of await dependencyTargets(folder.path)) {
      let keepWorkspace = false;
      const info = await inspect(path);
      if (folder.status === 'approved' && info?.isDirectory() && !info.isSymbolicLink()) {
        const workspace = resolve(path, '@workspace');
        if (await directory(workspace)) {
          const names = await readdir(workspace);
          for (const name of names) {
            const link = resolve(workspace, name);
            const entry = await inspect(link);
            if (!entry?.isSymbolicLink() || (await readlink(link)).startsWith('/')) {
              throw new Error(`Expected relative frozen workspace link: ${link}`);
            }
            const destination = await realpath(link);
            if (!['lib', 'artifacts'].some(group =>
              destination.startsWith(resolve(folder.path, group) + '/'))) {
              throw new Error(`Workspace link escapes frozen stage: ${link}`);
            }
          }
          keepWorkspace = names.length > 0;
        }
      }
      targets.push({ path, keepWorkspace });
    }
  }
  const removed = [];
  for (const { path: target, keepWorkspace } of targets) {
    if (!await inspect(target)) continue;
    if (keepWorkspace) {
      // Runtime CJS imports resolve through these tiny links into retained
      // frozen source. Remove installations, not the runtime workspace graph.
      const entries = (await readdir(target)).filter(name => name !== '@workspace');
      for (const name of entries) await rm(resolve(target, name), { recursive: true, force: true });
      if (entries.length) removed.push(target.slice(root.length + 1));
      continue;
    }
    // rm unlinks a node_modules symlink without following its external target.
    // No recursive search: bundled static assets can contain node_modules paths.
    await rm(target, { recursive: true, force: true });
    removed.push(target.slice(root.length + 1));
  }
  return {
    removed,
    approved: folders.filter(folder => folder.status === 'approved').map(folder => folder.name),
    scratch: folders.filter(folder => folder.status === 'scratch').map(folder => folder.name),
    preserved: ['root node_modules', 'validated frozen workspace links', 'compiled outputs', 'static assets', 'source archives', 'rollback assets'],
  };
}

/** Total bytes of regular files and symlink entries; symlinks are never followed. */
async function treeSize(path) {
  const info = await inspect(path);
  if (!info) return 0;
  if (!info.isDirectory() || info.isSymbolicLink()) return info.size;
  let total = 0;
  const entries = await readdir(path);
  for (let i = 0; i < entries.length; i += 128) {
    const sizes = await Promise.all(entries.slice(i, i + 128).map(entry => treeSize(resolve(path, entry))));
    for (const size of sizes) total += size;
  }
  return total;
}

/** Top-level names the publisher ignores. Only exact, glob-free names count. */
async function ignoredTopLevel(root) {
  const names = new Set(['.git']); // never an image input
  const text = await readFile(resolve(root, '.replitignore'), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^\//, '').replace(/\/$/, '');
    if (line && !line.startsWith('#') && !/[*?[!/]/.test(line)) names.add(line);
  }
  return names;
}

export function resolveImageLimit(env = process.env) {
  const value = env.DEPLOYMENT_IMAGE_WARN_BYTES;
  if (value === undefined || value === '') return DEFAULT_IMAGE_WARN_BYTES;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('DEPLOYMENT_IMAGE_WARN_BYTES must be a positive whole number of bytes');
  }
  return Number(value);
}

/**
 * Read-only report of what will be uploaded. The total is an estimate of the
 * workspace content minus top-level names in `.replitignore`.
 */
export async function reportDeploymentImage(root, { limitBytes = DEFAULT_IMAGE_WARN_BYTES } = {}) {
  root = resolve(root);
  const folders = [];
  for (const folder of await classifyBuildFolders(root)) {
    folders.push({ name: folder.name, status: folder.status, bytes: await treeSize(folder.path) });
  }
  const ignored = await ignoredTopLevel(root);
  let totalBytes = 0;
  for (const entry of await readdir(root)) {
    if (!ignored.has(entry)) totalBytes += await treeSize(resolve(root, entry));
  }
  return { folders, totalBytes, limitBytes, overLimit: totalBytes > limitBytes };
}

const mib = bytes => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
export function formatImageReport(report) {
  const lines = ['Deployment image content (folders under .consistency-build and .hydrate-release):'];
  for (const folder of report.folders) {
    lines.push(`  ${folder.name.padEnd(80)} ${folder.status.padEnd(14)} ${mib(folder.bytes)}`);
  }
  lines.push(`  Total image content (estimate): ${mib(report.totalBytes)}; warning limit ${mib(report.limitBytes)}`);
  if (report.overLimit) {
    lines.push(`  !!! WARNING: image content is over the ${mib(report.limitBytes)} limit; the upload may fail. Remove scratch folders or large inputs before publishing. !!!`);
  }
  return lines;
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
  const limitBytes = resolveImageLimit();
  let result;
  try {
    result = await cleanupBuildDependencies(root);
  } catch (error) {
    // Show every folder's status (including the invalid marker) before failing.
    for (const line of formatImageReport(await reportDeploymentImage(root, { limitBytes }))) console.log(line);
    throw error;
  }
  const report = await reportDeploymentImage(root, { limitBytes });
  console.log('Deployment dependency cleanup:', JSON.stringify({ ...result, image: report }));
  for (const line of formatImageReport(report)) console.log(line);
  await pruneStore(root); // Preserve the previous post-build store-prune step.
}
