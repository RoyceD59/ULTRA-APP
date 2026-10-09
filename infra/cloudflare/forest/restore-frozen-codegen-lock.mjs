/** Restore unchanged codegen peer contexts after an isolated security refresh. */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [draftInput, parserStageInput, parentLockInput] = process.argv.slice(2);
if (!draftInput || !parserStageInput) throw new Error('Supply draft and installed parser stage');
const draft = resolve(draftInput);
const parserStage = resolve(parserStageInput);
const require = createRequire(resolve(parserStage, 'package.json'));
const yaml = require(resolve(parserStage, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'));
const before = yaml.parseDocument(parentLockInput
  ? await readFile(resolve(parentLockInput), 'utf8')
  : execFileSync('tar', ['-xOf',
  'infra/cloudflare/forest/auth-upload-security/release-sources.tar.gz',
  'pnpm-lock.yaml'], { encoding: 'utf8' }));
const lockPath = resolve(draft, 'pnpm-lock.yaml');
const after = yaml.parseDocument(await readFile(lockPath, 'utf8'));
after.setIn(['importers', 'lib/api-spec'], before.getIn(['importers', 'lib/api-spec'], true).clone());
const codegenKey = key => /^(?:@orval\/|orval@|typescript@6\.0\.3(?:$|\())/.test(key);
for (const section of ['packages', 'snapshots']) {
  const oldMap = before.get(section, true);
  const newMap = after.get(section, true);
  for (const entry of [...newMap.items]) {
    const key = entry.key.value;
    if (codegenKey(key) && !oldMap.has(key)) newMap.delete(key);
  }
  for (const entry of oldMap.items) {
    const key = entry.key.value;
    if (codegenKey(key)) newMap.set(key, entry.value.clone());
  }
}
// Restored peer contexts must retain their complete dependency graph, not just
// the top-level codegen rows (e.g. TypeDoc's original TypeScript peer).
const oldSnapshots = before.get('snapshots', true);
const snapshots = after.get('snapshots', true);
const packages = after.get('packages', true);
const queue = oldSnapshots.items.filter(entry => codegenKey(entry.key.value))
  .map(entry => entry.key.value);
const visited = new Set();
while (queue.length) {
  const key = queue.shift();
  if (visited.has(key)) continue;
  visited.add(key);
  const source = oldSnapshots.get(key, true);
  if (!source) throw new Error(`Missing retained codegen snapshot: ${key}`);
  if (!snapshots.has(key)) snapshots.set(key, source.clone());
  const base = key.split('(')[0];
  if (!packages.has(base)) {
    const pkg = before.getIn(['packages', base], true);
    if (!pkg) throw new Error(`Missing retained codegen package: ${base}`);
    packages.set(base, pkg.clone());
  }
  const value = snapshots.get(key, true).toJSON();
  for (const [name, version] of Object.entries({
    ...value.dependencies, ...value.optionalDependencies,
  })) {
    const dependency = `${name}@${version}`;
    if (!snapshots.has(dependency) && oldSnapshots.has(dependency)) queue.push(dependency);
  }
}
await writeFile(lockPath, after.toString({
  lineWidth: 0,
  // Keep the sealed review's original formatting, but retain pnpm's compact
  // flow-map style when aligning main to its own saved pre-refresh lock.
  flowCollectionPadding: !parentLockInput,
}));
