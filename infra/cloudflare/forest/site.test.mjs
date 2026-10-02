import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

test('build publishes only approved static assets and a configured API origin', async () => {
  execFileSync(process.execPath, ['infra/cloudflare/forest/build.mjs']);
  const dir = 'artifacts/uc-companion/forest-dist';
  assert.deepEqual((await readdir(dir)).sort(), ['404.html', '_headers', 'index.html', 'programme-status.json']);
  const html = await readFile(`${dir}/index.html`, 'utf8');
  assert.ok(html.includes('<meta name="uc-api-base" content="https://api.ucfilters.com">'));
  assert.ok(!html.includes('1723000') && !html.includes('const INTERIM_AVERAGE_KES'));
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.throws(() => execFileSync(process.execPath, ['infra/cloudflare/forest/build.mjs'], {
    env: { ...process.env, FOREST_API_BASE: 'https://user:secret@example.org/?token=sensitive' }, stdio: 'pipe',
  }));
});

test('visitor inputs require anonymous ID and supported stage; field labels are not verification', async () => {
  const html = await readFile('artifacts/uc-companion/forest/forest.html', 'utf8');
  const fn = html.match(/function readVisitor\(\) \{[\s\S]*?\n\}/)[0];
  const context = vm.createContext({
    URLSearchParams, ID_RE: /^UC-[A-HJ-NP-Z2-9]{6}$/,
    STAGE_KEYS: ['seed', 'sprout', 'sapling', 'growing', 'funded', 'established'],
    location: { search: '?tree=UC-ABCDEF&stage=growing', hash: '' },
  });
  vm.runInContext(fn, context);
  assert.equal(vm.runInContext('readVisitor().stage', context), 'growing');
  for (const search of ['?tree=123&stage=seed', '?tree=UC-ABCDEF&stage=none', '?tree=UC-ABCDEF&stage=invalid', '?tree=UC-ABCDEF']) {
    context.location.search = search;
    assert.equal(vm.runInContext('readVisitor()', context), null);
  }
  context.location.hash = '#tree-UC-ABCDEF-sapling';
  assert.equal(vm.runInContext('readVisitor().stage', context), 'sapling');
  assert.ok(html.includes('not independently verified field status'));
});