/** Exercise unchanged consumer fixtures against the unselected review stage. */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(await readFile(resolve(here, 'security-dependency-review/candidate.json')));
const stage = resolve(here, '../../../.consistency-build', meta.candidateSha256);
const source = await readFile(resolve(here, 'consistency-security-runtime.test.mjs'), 'utf8');
const binding = "import { stage } from './consistency-handoff.mjs';";
if (source.split(binding).length !== 2) throw new Error('Unexpected consumer fixture stage binding');
const temporary = await mkdtemp(resolve(tmpdir(), 'security-review-consumers-'));
try {
  const fixture = resolve(temporary, 'consumers.test.mjs');
  await writeFile(fixture, source.replace(binding, `const stage = ${JSON.stringify(stage)};`));
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', fixture],
    { stdio: 'inherit', env: { ...process.env, GOMAXPROCS: '2' } });
  if (result.error || result.status !== 0) throw result.error ?? new Error('Installed consumer checks failed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
