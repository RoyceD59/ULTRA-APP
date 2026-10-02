import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = resolve(root, 'artifacts/uc-companion/forest');
const output = resolve(root, 'artifacts/uc-companion/forest-dist');
const api = new URL(process.env.FOREST_API_BASE || 'https://api.ucfilters.com');
if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || api.pathname !== '/') {
  throw new Error('FOREST_API_BASE must be a credential-free HTTPS origin');
}
const html = await readFile(resolve(source, 'forest.html'), 'utf8');
const marker = '<meta name="uc-api-base" content="">';
if (!html.includes(marker)) throw new Error('Missing API build marker');
const status = JSON.parse(await readFile(resolve(source, 'programme-status.json'), 'utf8'));
if (!status || typeof status !== 'object' || !Array.isArray(status.updates)) throw new Error('Invalid programme status');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'index.html'), html.replace(marker, `<meta name="uc-api-base" content="${api.origin}">`));
// Explicit allowlist: never publish repository files, credentials or build tooling.
for (const file of ['programme-status.json', '_headers', '404.html']) {
  await copyFile(resolve(source, file), resolve(output, file));
}
console.log(`Forest static site built at ${output}; public totals: ${api.origin}`);