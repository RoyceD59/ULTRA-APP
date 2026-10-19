/**
 * Refresh the generated release archive, never the working-tree application.
 * Reapply its narrow integration delta onto an explicitly selected live revision.
 * Conflicts stop packaging; resolve them in generated staging before retrying.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const manifestPath = resolve(here, 'release-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Supply the exact new live revision');
const live = await fetch('https://app.ucfilters.com/version.json', {
  cache: 'no-store', signal: AbortSignal.timeout(15000),
}).then(response => {
  if (!response.ok) throw new Error('Cannot verify the live revision');
  return response.json();
});
if (live.revision !== revision) throw new Error('Selected revision is not the current live release');
const oldArchive = resolve(here, 'release-sources.tar.gz');
const oldBytes = await readFile(oldArchive);
if (createHash('sha256').update(oldBytes).digest('hex') !== manifest.sourceArchiveSha256) {
  throw new Error('Existing archive checksum mismatch');
}
const work = await mkdtemp(resolve(tmpdir(), 'hydrate-reconcile-'));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 40 * 1024 * 1024 });
const require = createRequire(import.meta.url);
const YAML = require(require.resolve('yaml', { paths: [resolve(root, 'node_modules/.pnpm/node_modules')] }));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mergeSpec(base, live, integrated, path = '') {
  if (equal(base, integrated)) return live;
  if (equal(base, live) || equal(live, integrated)) return integrated;
  if ([base, live, integrated].every(value => value && typeof value === 'object' && !Array.isArray(value))) {
    return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(live), ...Object.keys(integrated)])]
      .map(key => [key, mergeSpec(base[key], live[key], integrated[key], `${path}/${key}`)]));
  }
  throw new Error(`Conflicting OpenAPI changes at ${path}`);
}
const roots = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
  'tsconfig.base.json', '.npmrc', 'artifacts/api-server', 'artifacts/projecthub',
  'artifacts/uc-companion', 'lib', 'scripts', 'patches'];
const safe = path => !/(^|\/)(node_modules|\.git|\.agents|\.env(?:\.[^/]+)?|\.whatsapp-session|dist|static-build|coverage)(\/|$)/.test(path)
  && !path.startsWith('artifacts/api-server/data/')
  && !path.includes('forest-preview-fixture') && !/\.(?:keystore|jks)$/.test(path);
const generated = path => /^lib\/(api-client-react|api-zod)\/src\/generated\//.test(path);
async function snapshot(sha, target) {
  await mkdir(target);
  const paths = git('ls-tree', '-r', '--name-only', sha, '--', ...roots)
    .toString().trim().split('\n').filter(path => path && safe(path));
  execFileSync('tar', ['-x', '-C', target], {
    input: git('archive', sha, '--', ...paths), maxBuffer: 40 * 1024 * 1024,
  });
}
const oldBase = resolve(work, 'old-base');
const packed = resolve(work, 'packed');
const next = resolve(work, 'next');
await snapshot(manifest.liveBaseRevision, oldBase);
await snapshot(revision, next);
await mkdir(packed);
execFileSync('tar', ['-xzf', oldArchive, '-C', packed]);
const paths = execFileSync('tar', ['-tzf', oldArchive], { encoding: 'utf8' })
  .split('\n').filter(path => path && !path.endsWith('/'));
const changed = [];
const conflicts = [];
for (const path of paths) {
  if (!safe(path)) throw new Error(`Unsafe existing archive entry: ${path}`);
  if (generated(path)) continue; // Regenerate contracts against the combined specification.
  const integrated = await readFile(resolve(packed, path));
  const original = await readFile(resolve(oldBase, path)).catch(() => null);
  if (original?.equals(integrated)) continue;
  let targetPath = path;
  // Review analysis now owns 0056 in the newly published baseline.
  if (path === 'lib/db/migrations/0056_uc_hydrate_trees.sql') {
    targetPath = 'lib/db/migrations/0057_uc_hydrate_trees.sql';
  }
  if (/^lib\/db\/migrations\/\d+_uc_hydrate_trees\.sql$/.test(targetPath)) {
    const number = targetPath.split('/').at(-1).split('_')[0];
    const collisions = (await readdir(resolve(next, 'lib/db/migrations')))
      .filter(name => name.startsWith(`${number}_`) && name !== targetPath.split('/').at(-1));
    if (collisions.length) throw new Error(`Hydrate migration number is reserved by ${collisions.join(', ')}`);
  }
  const target = resolve(next, targetPath);
  const newer = await readFile(target).catch(() => null);
  await mkdir(dirname(target), { recursive: true });
  if (!newer || (original && newer.equals(original)) || newer.equals(integrated)) {
    await writeFile(target, integrated);
  } else if (!original) {
    conflicts.push(targetPath);
    continue;
  } else {
    if (path === 'lib/api-spec/openapi.yaml') {
      await writeFile(target, YAML.stringify(mergeSpec(
        YAML.parse(original.toString()), YAML.parse(newer.toString()), YAML.parse(integrated.toString()),
      )));
      changed.push(targetPath);
      continue;
    }
    // Only these two independently appended registration/startup additions may
    // use union merging. Assert the old delta first; never union arbitrary code.
    const additiveIndex = path === 'artifacts/api-server/src/index.ts' &&
      integrated.toString()
        .replace(/^import \{ ensureHydrateTreeSchema \}.*\n/m, '')
        .replace(/^  await ensureHydrateTreeSchema\(pool\);\n/m, '')
        .replace(/^  logger\.info\("Startup migration: hydrate shared trees ensured"\);\n/m, '')
        .trim() === original.toString().trim();
    const additiveSchema = path === 'lib/db/src/schema/index.ts' &&
      integrated.toString().replace(/^export \* from "\.\/uc-hydrate-trees\.js";\n/m, '').trim() === original.toString().trim();
    const result = spawnSync('git', ['merge-file', '-p', target, resolve(oldBase, path), resolve(packed, path)], {
      encoding: 'utf8', maxBuffer: 40 * 1024 * 1024,
    });
    if (result.status !== 0) {
      if (!additiveIndex && !additiveSchema) {
        conflicts.push(targetPath);
        continue;
      }
      const union = execFileSync('git', ['merge-file', '--union', '-p', target,
        resolve(oldBase, path), resolve(packed, path)], { encoding: 'utf8' });
      await writeFile(target, union);
    } else {
      await writeFile(target, result.stdout);
    }
  }
  changed.push(targetPath);
}
console.log(JSON.stringify({ work, next, changed, conflicts }, null, 2));
if (conflicts.length) throw new Error('Archive reconciliation conflicts; no release files replaced');
// This already-published expression has a never[] inference error under tsc.
// A callback annotation fixes compilation without changing generated JS.
const alisonPath = resolve(next, 'artifacts/api-server/src/lib/alison-knowledge.ts');
const alison = await readFile(alisonPath, 'utf8');
await writeFile(alisonPath, alison.replace('.filter((word) => word.length', '.filter((word: string) => word.length'));
// Include the new API contracts without overwriting the working-tree generated code.
execFileSync('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], {
  cwd: next, stdio: 'inherit', env: { ...process.env, CI: '1' },
});
execFileSync('pnpm', ['exec', 'orval', '--config', './orval.config.ts'], {
  cwd: resolve(next, 'lib/api-spec'), stdio: 'inherit',
});
execFileSync('node', ['./scripts/fix-zod-declaration-order.mjs'], {
  cwd: resolve(next, 'lib/api-spec'), stdio: 'inherit',
});
await writeFile(resolve(next, 'lib/api-zod/src/index.ts'), 'export * from "./generated/api";\n');
const candidate = resolve(work, 'release-sources.tar.gz');
execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
  '--exclude=node_modules', '--exclude=*.tsbuildinfo', '-czf', candidate, '-C', next,
  ...roots.filter(path => paths.some(entry => entry === path || entry.startsWith(`${path}/`)))]);
const digest = createHash('sha256').update(await readFile(candidate)).digest('hex');
// Candidate and manifest are replaced only after reconciliation/codegen succeed.
await writeFile(oldArchive, await readFile(candidate));
await writeFile(manifestPath, `${JSON.stringify({
  ...manifest, liveBaseRevision: revision, sourceArchiveSha256: digest,
  previousLiveBaseRevision: manifest.liveBaseRevision,
}, null, 2)}\n`);
await rm(resolve(work, 'packed'), { recursive: true, force: true });
await rm(resolve(work, 'old-base'), { recursive: true, force: true });
console.log(`Reconciled release sources against ${revision}; SHA-256 ${digest}`);