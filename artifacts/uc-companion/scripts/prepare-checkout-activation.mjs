import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(project, '../..');
const destination = path.join(workspace, '.checkout-activation-release');
const companion = path.join(destination, 'companion');
const require = createRequire(import.meta.url);
const { readActiveBuild } = require('./active-static-build.cjs');
const hash = filename => fs.existsSync(filename) ? crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') : null;
const selection = path.join(project, 'static-build', 'active-build.json');
const frozenManifest = path.join(workspace, 'infra/cloudflare/forest/release-manifest.json');
const before = { activeBuildId: readActiveBuild(path.join(project, 'static-build')), selectionHash: hash(selection),
  frozenManifestHash: hash(frozenManifest) };
const sources = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: workspace, encoding: 'utf8' })
  .trim().split('\n').filter(p => /^(lib\/|artifacts\/(uc-companion|api-server|projecthub)\/)/.test(p) &&
    !/\/(node_modules|dist|\.expo|data|static-build|forest-dist)\//.test(p) && fs.statSync(path.join(workspace, p)).isFile());
const sourceHashes = Object.fromEntries(sources.map(p => [p, hash(path.join(workspace, p))]));
if (!process.env.REPLIT_EXPO_DEV_DOMAIN) throw new Error('A development preview domain is required; this script never selects a production domain.');
fs.mkdirSync(destination, { recursive: true });
execFileSync('node', ['scripts/build.js'], { cwd: project, stdio: 'inherit', env: { ...process.env,
  UC_PREPARED_OUTPUT_DIR: companion, EXPO_PUBLIC_DOMAIN: process.env.REPLIT_EXPO_DEV_DOMAIN,
  EXPO_PUBLIC_API_DOMAIN: process.env.REPLIT_EXPO_DEV_DOMAIN, BASE_PATH: '/uc-companion' } });
execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', path.join(destination, 'projecthub')], {
  cwd: path.join(workspace, 'artifacts/projecthub'), stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '20100', BASE_PATH: '/' },
});
execFileSync('pnpm', ['run', 'build'], { cwd: path.join(workspace, 'artifacts/api-server'), stdio: 'inherit' });
fs.cpSync(path.join(workspace, 'artifacts/api-server/dist'), path.join(destination, 'api'), { recursive: true });
const after = { activeBuildId: readActiveBuild(path.join(project, 'static-build')), selectionHash: hash(selection),
  frozenManifestHash: hash(frozenManifest) };
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Active Companion selection unexpectedly changed.');
const changedDuringBuild = sources.filter(p => sourceHashes[p] !== hash(path.join(workspace, p)));
if (changedDuringBuild.length) throw new Error(`Source changed during preparation: ${changedDuringBuild.join(', ')}`);
const candidateBuildId = readActiveBuild(path.join(companion, 'static-build'));
const evidence = { preparedAt: new Date().toISOString(), sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim(),
  scope: 'Current workspace candidate, not a transplanted approved/frozen release. Includes uncommitted contact/activation fixes.',
  candidateBuildId, unchangedActiveSelection: after, browserBasePath: '/uc-companion',
  published: false, deviceTested: false, sourceHashes };
fs.writeFileSync(path.join(destination, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(`Prepared isolated checkout/activation candidate ${candidateBuildId}. No publication or active-release change.`);