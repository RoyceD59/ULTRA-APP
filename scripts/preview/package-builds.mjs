import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Only public web exports copied from the already-tested isolated containers.
// Never include the API workspace, database, environment or dependency tree.
const root = resolve(process.argv[2] || 'preview-builds');
const sourceRevision = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(sourceRevision || '')) throw new Error('Exact CI source revision required');
const files = [];
async function inspect(relative) {
  for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink() || /^\.env(?:\.|$)/i.test(entry.name) || /\.(?:pem|key)$/i.test(entry.name)) {
      throw new Error(`Unexpected private or linked file in public export: ${name}`);
    }
    if (entry.isDirectory()) await inspect(name);
    else if (entry.isFile()) {
      const bytes = await readFile(join(root, name));
      files.push({ path: name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } else throw new Error(`Unexpected export entry: ${name}`);
  }
}
for (const app of ['companion', 'hub']) {
  if (!(await stat(join(root, app, 'index.html'))).isFile()) throw new Error(`${app} web entry missing`);
  await inspect(app);
}
const manifest = {
  purpose: 'isolated-web-preview', productionEligible: false, fixtureOnly: true,
  sourceRevision, createdAt: new Date().toISOString(),
  workflowRun: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  origins: { companion: 'http://localhost:3000', hub: 'http://localhost:5055', api: 'http://localhost:5000' },
  nativeBinaryIncluded: false, databaseIncluded: false,
  note: 'These web exports use disposable preview configuration. They are not the approved frozen production candidate or a phone acceptance build.',
  files: [...files],
};
await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(root, 'README.txt'), `Ultra Clear isolated web preview\nSource: ${sourceRevision}\n\nCompanion: companion/\nProject Hub: hub/\nIntegrity: manifest.json and SHA256SUMS\n\nFixture-only, NOT FOR PRODUCTION. No database, accounts, credentials, API service or native binary is included. Opening index.html directly is not a complete application test.\n\nFor an interactive full-stack preview, check out this exact source revision and use scripts/preview/Start-Preview.ps1 with Docker Desktop running. It builds the matching isolated API/database and exposes localhost:3000 (Companion), localhost:5055 (Hub), localhost:5000 (API). The compiled files here are retained review evidence.\n\nPhysical-phone checks remain under task #822 using the separately approved Replit candidate. Do not publish these fixture exports to the live hosts or expose the local preview database.\n`);
for (const path of ['manifest.json', 'README.txt']) {
  const bytes = await readFile(join(root, path));
  files.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(root, 'SHA256SUMS'), files.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n');
console.log(`Packaged ${manifest.files.length} public web files for ${sourceRevision}; fixture-only, not published.`);
