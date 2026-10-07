import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { originalArchive, verifyHandoff, here } from './consistency-handoff.mjs';
import { dependencyArchive as archive } from './auth-upload-security.mjs';
import { securityLock } from './consistency-security.mjs';

test('security revision changes only the lockfile, preserving all approved application bytes', async () => {
  await verifyHandoff();
  const temporary = await mkdtemp(resolve(tmpdir(), 'consistency-security-'));
  try {
    const files = file => execFileSync('tar', ['-tzf', file], { encoding: 'utf8' })
      .split('\n').filter(path => path && !path.endsWith('/')).sort();
    assert.deepEqual(files(archive), files(originalArchive));
    for (const [file, directory] of [[archive, 'new'], [originalArchive, 'old']]) {
      execFileSync('mkdir', ['-p', resolve(temporary, directory)]);
      execFileSync('tar', ['-xzf', file, '-C', resolve(temporary, directory)]);
    }
    const changed = [];
    for (const path of files(archive)) {
      const before = await readFile(resolve(temporary, 'old', path));
      const after = await readFile(resolve(temporary, 'new', path));
      if (!before.equals(after)) changed.push(path);
    }
    assert.deepEqual(changed, ['pnpm-lock.yaml']);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('security lock delta rejects unfamiliar anchors rather than resolving the frozen tree again', () => {
  const old = execFileSync('tar', ['-xOf', originalArchive, 'pnpm-lock.yaml'], { encoding: 'utf8' });
  const next = execFileSync('tar', ['-xOf', archive, 'pnpm-lock.yaml'], { encoding: 'utf8' });
  assert.equal(securityLock(old), next);
  assert.throws(() => securityLock(old.replace('compression@1.8.1:', 'compression@9.0.0:')));
  assert.throws(() => securityLock(old.replace('      proxy-addr: 2.0.7\n', '')));
});

test('deployment preparation executes actual-consumer security checks before compilation', async () => {
  const builder = await readFile(resolve(here, 'build-approved-consistency.mjs'), 'utf8');
  const compile = builder.indexOf("await run('pnpm', ['--filter', packages[mode], 'run', 'build']");
  for (const fixture of ['scripts/tests/dependency-security.test.mjs', 'consistency-security-runtime.test.mjs']) {
    const guard = builder.indexOf(fixture);
    assert.ok(guard > builder.indexOf("} else {") && guard < compile);
  }
});
