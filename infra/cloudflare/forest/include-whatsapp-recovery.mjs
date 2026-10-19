/**
 * Include only the approved WhatsApp recovery commit in the frozen release.
 * Refuse to overwrite a different archived implementation or include other work.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Supply the approved recovery commit');
const files = [
  'artifacts/api-server/src/lib/whatsapp-operations.ts',
  'artifacts/api-server/src/lib/whatsapp.ts',
  'artifacts/api-server/src/routes/whatsapp.ts',
  'artifacts/api-server/src/tests/whatsapp-operations.test.ts',
  'artifacts/projecthub/src/components/whatsapp-qr-card.test.tsx',
  'artifacts/projecthub/src/components/whatsapp-qr-card.tsx',
  'artifacts/projecthub/src/lib/whatsapp-request.test.ts',
  'artifacts/projecthub/src/lib/whatsapp-request.ts',
];
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 40 * 1024 * 1024 });
const archive = resolve(here, 'release-sources.tar.gz');
const manifestPath = resolve(here, 'release-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const bytes = await readFile(archive);
if (createHash('sha256').update(bytes).digest('hex') !== manifest.sourceArchiveSha256) {
  throw new Error('Existing archive checksum mismatch');
}
const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  .split('\n').filter(path => path && !path.endsWith('/'));
if (paths.some(path => path.startsWith('/') || path.split('/').includes('..'))) {
  throw new Error('Unsafe archive path');
}
const work = await mkdtemp(resolve(tmpdir(), 'whatsapp-release-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', work]);
  let changed = false;
  for (const path of files) {
    const next = git('show', `${revision}:${path}`);
    let previous = null;
    // New recovery helpers have no preimage.
    const existed = git('ls-tree', `${revision}^`, '--', path).length > 0;
    if (existed) previous = git('show', `${revision}^:${path}`);
    const packed = await readFile(resolve(work, path)).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!(packed?.equals(next) || (previous ? packed?.equals(previous) : packed === null))) {
      throw new Error(`Archived ${path} differs from the approved preimage; reconcile manually`);
    }
    if (!packed?.equals(next)) changed = true;
    await mkdir(dirname(resolve(work, path)), { recursive: true });
    await writeFile(resolve(work, path), next);
  }
  const entries = [...new Set([...paths, ...files])].sort();
  const candidate = resolve(work, 'candidate.tar.gz');
  execFileSync('tar', [
    '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-czf', candidate, '-C', work, '-T', '-',
  ], { input: `${entries.join('\n')}\n` });
  const updated = await readFile(candidate);
  await writeFile(archive, updated);
  await writeFile(manifestPath, `${JSON.stringify({
    ...manifest,
    sourceArchiveSha256: createHash('sha256').update(updated).digest('hex'),
    whatsappRecoveryRevision: revision,
    ...(changed ? {
      whatsappRecoverySourceBaseRevision: git('rev-parse', 'HEAD').toString().trim(),
      whatsappRecoverySourceArchiveSha256: createHash('sha256').update(bytes).digest('hex'),
    } : {}),
  }, null, 2)}\n`);
  console.log('Frozen release updated with approved WhatsApp recovery files only');
} finally {
  await rm(work, { recursive: true, force: true });
}