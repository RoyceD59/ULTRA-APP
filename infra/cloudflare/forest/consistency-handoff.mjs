import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ORIGINAL_CANDIDATE, securityLock } from './consistency-security.mjs';
import { AUTH_UPLOAD_CANDIDATE, DEPENDENCY_CANDIDATE, SCOPE_SHA256, authUploadArchive, dependencyArchive, verifyAuthUploadRevision } from './auth-upload-security.mjs';
import { SECURITY_CENTER_CANDIDATE, securityCenterArchive, verifySecurityCenterSelection } from './security-center-selection.mjs';
import { PRODUCT_PAGE_CANDIDATE, productPageArchive, verifyProductPageSelection } from './product-page-selection.mjs';

export const APPROVED_CANDIDATE = PRODUCT_PAGE_CANDIDATE;
export const PREDECESSOR = 'bdc71175d7f653c99d9d431770200915acd2e8333220c59b8b66a3d48e03d3b2';
export const API_ORIGINS = [
  'https://api.ucfilters.com',
  'https://team-horizon--jerryaroyce.replit.app',
];
export const SOURCE_IDENTITY = `consistency-${APPROVED_CANDIDATE}`;
export const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, '../../..');
export const originalArchive = resolve(here, 'approved-consistency/release-sources.tar.gz');
export const archive = productPageArchive;
export const stage = resolve(root, '.consistency-build', APPROVED_CANDIDATE);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Verify saved bytes, not today's workspace or a regenerated candidate. */
export async function verifyHandoff() {
  const original = JSON.parse(await readFile(resolve(here, 'approved-consistency/candidate.json'), 'utf8'));
  const dependency = JSON.parse(await readFile(resolve(here, 'security-consistency/candidate.json'), 'utf8'));
  const approval = JSON.parse(await readFile(resolve(here, 'auth-upload-security/owner-approval.json'), 'utf8'));
  const info = await verifyAuthUploadRevision();
  if (info.candidateSha256 !== AUTH_UPLOAD_CANDIDATE || info.baselineSha256 !== PREDECESSOR
      || digest(await readFile(authUploadArchive)) !== AUTH_UPLOAD_CANDIDATE
      || original.candidateSha256 !== ORIGINAL_CANDIDATE || original.baselineSha256 !== PREDECESSOR
      || digest(await readFile(originalArchive)) !== ORIGINAL_CANDIDATE
      || info.originalCandidateSha256 !== ORIGINAL_CANDIDATE
      || dependency.candidateSha256 !== DEPENDENCY_CANDIDATE || dependency.baselineSha256 !== PREDECESSOR
      || dependency.originalCandidateSha256 !== ORIGINAL_CANDIDATE
      || JSON.stringify(dependency.securityChangedPaths) !== '["pnpm-lock.yaml"]'
      || approval.candidateSha256 !== AUTH_UPLOAD_CANDIDATE || approval.scopeSha256 !== SCOPE_SHA256
      || approval.selectionApproved !== true || approval.publicationApproved !== false
      || digest(await readFile(resolve(here, 'release-sources.tar.gz'))) !== PREDECESSOR) {
    throw new Error('Approved candidate or retained predecessor checksum mismatch');
  }
  const lock = file => execFileSync('tar', ['-xOf', file, 'pnpm-lock.yaml'], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (securityLock(lock(originalArchive)) !== lock(dependencyArchive)
      || lock(dependencyArchive) !== lock(authUploadArchive)) {
    throw new Error('Security candidate includes an unapproved dependency delta');
  }
  await verifySecurityCenterSelection();
  return { ...info, ...await verifyProductPageSelection() };
}

export function validateSnapshot(value, now = Date.now()) {
  const date = Date.parse(value?.calculatedAt);
  if (!value || !/^[a-f0-9]{64}$/.test(value.snapshotId)
      || !Number.isSafeInteger(value.adjustmentRevision) || value.adjustmentRevision < 1
      || value.maxAgeSeconds !== 60 || typeof value.lifespanAvailable !== 'boolean'
      || !Number.isFinite(date) || date > now + 60_000 || now - date > 60_000
      || ['totalUsers', 'litresFiltered', 'plasticsAvoided', 'cleanWaterDays']
        .some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)) {
    throw new Error('Compatible, recent live global snapshot unavailable; clients must not advance');
  }
  // Only public comparison fields enter evidence/logs; never copy attribution.
  return {
    snapshotId: value.snapshotId, adjustmentRevision: value.adjustmentRevision,
    calculatedAt: value.calculatedAt, lifespanAvailable: value.lifespanAvailable,
    totalUsers: value.totalUsers, litresFiltered: value.litresFiltered,
    plasticsAvoided: value.plasticsAvoided, cleanWaterDays: value.cleanWaterDays,
  };
}

export async function verifyLiveApi(request = fetch, now = Date.now()) {
  const snapshots = await Promise.all(API_ORIGINS.map(async origin => {
    const response = await request(`${origin}/api/uc/impact`, {
      cache: 'no-store', headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Live global snapshot unavailable at ${origin} (${response.status})`);
    return validateSnapshot(await response.json(), now);
  }));
  const comparable = value => JSON.stringify({
    ...value, calculatedAt: undefined,
  });
  if (comparable(snapshots[0]) !== comparable(snapshots[1])) {
    throw new Error('Public API hosts disagree; capture calculation times and resolve before publishing clients');
  }
  return snapshots;
}

/** Add rollback assets without replacing any existing versioned byte or pointer. */
export async function retainRollback(source, destination, buildId) {
  if (!/^\d+-\d+$/.test(buildId) || resolve(source) === resolve(destination)) {
    throw new Error('Provide a separate verified rollback static directory and exact served build ID');
  }
  for (const directory of [source, resolve(source, buildId)]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Rollback release directory must be an ordinary directory, not a symlink');
    }
  }
  const info = JSON.parse(await readFile(resolve(source, buildId, 'build-info.json'), 'utf8'));
  if (info.buildId !== buildId) throw new Error('Rollback build metadata mismatch');
  const manifests = {};
  const assetUrls = new Set();
  for (const platform of ['web', 'ios', 'android']) {
    const bundle = await readFile(resolve(source, buildId, '_expo/static/js', platform, 'bundle.js'));
    if (!bundle.length) throw new Error('Rollback bundle is empty');
    const text = bundle.toString('utf8');
    for (const match of text.matchAll(/httpServerLocation:"([^"]+)"[^}]*name:"([^"]+)"[^}]*type:"([^"]+)"/g)) {
      assetUrls.add(`${match[1].replace(/\/$/, '')}/${match[2]}.${match[3]}`);
    }
    for (const match of text.matchAll(/["'](https:\/\/app\.ucfilters\.com\/uc-companion\/[^"'\\]+\/_expo\/static\/js\/[^"'\\]+)["']/g)) {
      // Directory-valued httpServerLocation entries are checked with their
      // name/type above; direct file-valued font/image exports are checked here.
      if (/\.[a-z0-9]+(?:\?|$)/i.test(match[1])) assetUrls.add(match[1]);
    }
    if (platform !== 'web') {
      const versioned = resolve(source, buildId, platform, 'manifest.json');
      const raw = await readFile(versioned).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return readFile(resolve(source, platform, 'manifest.json'));
      });
      const manifest = JSON.parse(raw);
      if (manifest.launchAsset?.key !== `bundle-${buildId}`
          || !manifest.launchAsset?.url?.includes(`/${buildId}/_expo/static/js/${platform}/`)) {
        throw new Error('Rollback native manifests do not match the actually served build');
      }
      for (const asset of manifest.assets ?? []) if (asset.url) assetUrls.add(asset.url);
      manifests[platform] = raw;
    }
  }
  for (const reference of assetUrls) {
    const url = new URL(reference);
    const prefix = `/uc-companion/${buildId}/`;
    if (url.origin !== 'https://app.ucfilters.com' || !url.pathname.startsWith(prefix)) {
      throw new Error('Rollback asset reference escapes its approved host or build');
    }
    const relative = decodeURIComponent(url.pathname.slice('/uc-companion/'.length));
    const bytes = await readFile(resolve(source, relative));
    if (!bytes.length) throw new Error('Rollback asset is empty');
  }
  const files = [];
  async function walk(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Rollback static directory must not contain symlinks');
      if (entry.isDirectory()) await walk(resolve(directory, entry.name), path);
      else if (entry.isFile()) {
        // Selection is operational state, not a versioned asset. Legacy root
        // manifests are retained under their exact release instead.
        if (path === 'active-build.json' || /^(ios|android)\/manifest\.json$/.test(path)) continue;
        files.push([path, await readFile(resolve(source, path))]);
      } else throw new Error('Unexpected rollback directory entry');
    }
  }
  // Retain only the verified release. Shared documentation, selection pointers
  // and reports for other releases are not immutable client assets.
  await walk(resolve(source, buildId), buildId);
  for (const name of [`${buildId}-capture.json`, 'capture-evidence.json']) {
    const bytes = await readFile(resolve(source, name)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (bytes) {
      // Each observation is immutable at its own content-addressed path.
      // Revalidation timestamps may change without replacing previous evidence.
      const digest = createHash('sha256').update(bytes).digest('hex');
      files.push([`rollback-evidence/${buildId}/${digest}.json`, bytes]);
    }
  }
  for (const [platform, bytes] of Object.entries(manifests)) {
    const path = `${buildId}/${platform}/manifest.json`;
    if (!files.some(([name]) => name === path)) files.push([path, bytes]);
  }
  // Detect collisions before copying any byte. Never silently replace old assets.
  for (const [path, bytes] of files) {
    const existing = await readFile(resolve(destination, path)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing && !existing.equals(bytes)) throw new Error(`Rollback asset collision: ${path}`);
  }
  for (const [path, bytes] of files) {
    await mkdir(dirname(resolve(destination, path)), { recursive: true });
    await writeFile(resolve(destination, path), bytes, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST'
          || !(await readFile(resolve(destination, path))).equals(bytes)) throw error;
    });
  }
  return { buildId, retainedFiles: files.length };
}
