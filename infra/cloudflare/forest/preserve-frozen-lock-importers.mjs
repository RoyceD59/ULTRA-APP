/**
 * Temporary manifests keep unused lock importers during an isolated refresh.
 * They are not included in the sealed source archive.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [draftInput, parserStageInput] = process.argv.slice(2);
if (!draftInput || !parserStageInput) throw new Error('Supply draft directory and installed YAML parser stage');
const draft = resolve(draftInput);
const installedStage = resolve(parserStageInput);
const require = createRequire(resolve(installedStage, 'package.json'));
const yaml = require(resolve(installedStage, 'node_modules/.pnpm/yaml@2.9.0/node_modules/yaml'));
const old = yaml.parse(execFileSync('tar', ['-xOf',
  'infra/cloudflare/forest/auth-upload-security/release-sources.tar.gz',
  'pnpm-lock.yaml'], { encoding: 'utf8' }));
const importer = old.importers['artifacts/mockup-sandbox'];
if (!importer) throw new Error('Expected frozen sandbox lock importer');
const manifest = { name: '@workspace/mockup-sandbox', version: '0.0.0', private: true };
for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  if (importer[kind]) {
    manifest[kind] = Object.fromEntries(
      Object.entries(importer[kind]).map(([name, value]) => [name, value.specifier]),
    );
  }
}
await mkdir(resolve(draft, 'artifacts/mockup-sandbox'), { recursive: true });
await writeFile(resolve(draft, 'artifacts/mockup-sandbox/package.json'), JSON.stringify(manifest, null, 2) + '\n');
