/**
 * Source-only candidate: approved consistency delta on the frozen archive.
 * Never changes the approved archive, release manifest, active builds or hosting.
 * Anchored transplants deliberately exclude unrelated merged workspace changes.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const output = resolve(root, '.companion-consistency-release');
const archive = resolve(here, 'release-sources.tar.gz');
const manifestFile = resolve(here, 'release-manifest.json');
const manifestBytes = await readFile(manifestFile);
const manifest = JSON.parse(manifestBytes);
const digest = value => createHash('sha256').update(value).digest('hex');
const beforeArchive = await readFile(archive);
if (digest(beforeArchive) !== manifest.sourceArchiveSha256) throw new Error('Frozen source checksum mismatch');
const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(p => p && !p.endsWith('/'));
if (paths.some(p => p.startsWith('/') || p.split('/').includes('..'))) throw new Error('Unsafe archive path');
const stage = resolve(output, 'source');
await rm(stage, { recursive: true, force: true }); // Only this disposable candidate.
await mkdir(stage, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', stage]);
const original = new Map(await Promise.all(paths.map(async p => [p, await readFile(resolve(stage, p))])));
const changed = new Set();
const source = p => readFile(resolve(root, p), 'utf8');
function once(text, old, replacement) {
  if (text.split(old).length !== 2) throw new Error(`Unexpected frozen anchor: ${old.slice(0, 100)}`);
  return text.replace(old, () => replacement);
}
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Missing source boundaries: ${start}`);
  return text.slice(a, b);
}
async function edit(p, transform) {
  const value = transform(original.get(p)?.toString('utf8') ?? '');
  await mkdir(dirname(resolve(stage, p)), { recursive: true });
  await writeFile(resolve(stage, p), value);
  changed.add(p);
}
// New, focused modules have no unrelated source dependencies.
for (const p of [
  'artifacts/api-server/src/lib/global-impact-store.ts',
  'artifacts/api-server/scripts/import-global-impact.ts',
  'lib/db/src/schema/uc-global-impact.ts',
  'lib/db/migrations/0067_uc_global_impact.sql',
  'artifacts/uc-companion/lib/globalImpact.ts',
  'artifacts/uc-companion/lib/releasePolicy.ts',
  'artifacts/uc-companion/components/ReleaseStatus.tsx',
  'artifacts/uc-companion/data/supported-native-releases.json',
  'artifacts/uc-companion/scripts/active-static-build.cjs',
  'artifacts/uc-companion/scripts/prepare-static-build.cjs',
  'artifacts/uc-companion/scripts/build-retention.js',
  'artifacts/uc-companion/lib/queryConnectivity.ts',
  'artifacts/uc-companion/lib/queryConnectivity.native.ts',
  'artifacts/uc-companion/lib/nativeQueryRecovery.ts',
  'artifacts/uc-companion/lib/nativeConnectionStatus.ts',
]) {
  if (original.has(p)) throw new Error(`Reconcile already-packaged consistency prerequisite: ${p}`);
  const text = await source(p);
  await edit(p, () => text);
}
// Whole-file replacements are safe only where the prior frozen source matches
// the known pre-task implementation. Do not broaden this to other files.
for (const [p, expected] of [
  ['artifacts/api-server/src/routes/uc-impact.ts', '3cb64446ff2ca253a7361e971bc640826e3adfe53449b153fcc8769bd253843b'],
  ['artifacts/uc-companion/hooks/useGlobalImpact.ts', '137655c710cb73c110d550642f3330eaa9c229f31dcb038f26d9473932d82059'],
]) {
  if (digest(original.get(p)) !== expected) throw new Error(`Frozen baseline changed: ${p}`);
  const text = await source(p);
  await edit(p, () => text);
}
await edit('lib/db/src/schema/index.ts', text => 'export * from "./uc-global-impact";\n' + text);
await edit('artifacts/api-server/src/index.ts', text =>
  'import { ensureGlobalImpactSchema } from "./lib/global-impact-store.js";\n' +
  once(text, 'async function applyStartupMigrations(): Promise<void> {',
    'async function applyStartupMigrations(): Promise<void> {\n  await ensureGlobalImpactSchema();'));

// Use only the newly generated contracts, not the workspace's other new APIs.
const spec = await source('lib/api-spec/openapi.yaml');
await edit('lib/api-spec/openapi.yaml', text => once(once(text, 'paths:\n', 'paths:\n' +
  between(spec, '  /uc/impact:\n', '  /uc/auth/register:\n')), '  schemas:\n', '  schemas:\n' +
  between(spec, '    GlobalImpactSnapshot:\n', '    RewardsQrCandidate:\n')));
const zod = await source('lib/api-zod/src/generated/api.ts');
const validators = between(zod, '/**\n * @summary Read account-independent',
  '/**\n * @summary Create an account with required normalized');
await edit('lib/api-zod/src/generated/api.ts', text => once(text, 'import * as zod from \'zod\';',
  'import * as zod from \'zod\';\n\n' + validators));
const types = await source('lib/api-client-react/src/generated/api.schemas.ts');
const newTypes = between(types, 'export type GlobalImpactSnapshotMaxAgeSeconds', 'export interface RewardsQrCandidate');
await edit('lib/api-client-react/src/generated/api.schemas.ts', text => newTypes + '\n' + text);

const hub = await source('artifacts/projecthub/src/pages/impact.tsx');
await edit('artifacts/projecthub/src/pages/impact.tsx', text => {
  text = once(text, 'interface ImpactData {', 'interface ImpactData {\n' +
    between(hub, '  snapshotId: string;', '  totalUsers:'));
  text = once(text, '    <ImpactDashboard\n', '    <ImpactDashboard\n      key={token}\n');
  text = once(text, "  const [error,   setError]   = useState('');", between(hub,
    "  const [error,   setError]   = useState('');", '  const [permissionMessage'));
  text = once(text, between(text, '  const loadRef = useRef(false);', '  async function handleLostEditAccess()'),
    between(hub, '  const loadRef = useRef(false);', '  async function handleLostEditAccess()'));
  text = once(text, "JSON.stringify({ litresOffset: litres, usersOffset: users, updatedBy: 'admin' })",
    'JSON.stringify({ litresOffset: litres, usersOffset: users, expectedRevision: formRevision })');
  text = once(text, '      const users  = parseFloat(usersOffset)  || 0;',
    between(hub, '      const users  = parseFloat(usersOffset)  || 0;', '      const res = await fetch'));
  text = once(text, 'disabled={legacySaving} size="sm"', 'disabled={legacySaving || !data} size="sm"');
  return once(text, '      {/* Error banner */}\n', between(hub, '      {/* Error banner */}\n', '      {error && ('));
});
const bubble = await source('artifacts/uc-companion/components/ImpactBubble.tsx');
await edit('artifacts/uc-companion/components/ImpactBubble.tsx', text => {
  text = once(text, '  value:   number;', '  value:   number | null;');
  text = once(text, '  const animated = useCountUp(value);\n', '');
  text = once(text, '{fmt(animated)}', "{value === null ? '—' : fmt(value)}");
  text = once(text, '  const { data: stats, isError, isPending, isFetching, refetch } = useGlobalImpact();',
    '  const { data: stats, isPending, isFetching, refetch, freshness, dataUpdatedAt } = useGlobalImpact();');
  text = once(text, "          {!!stats && !isError && <PulseDot />}\n          <Text style={styles.liveText}>{isError ? 'UNAVAILABLE' : stats ? 'LIVE' : 'LOADING'}</Text>",
    '          <Text style={styles.liveText}>{freshness}</Text>');
  text = once(text, between(text, '      {isError && <View', '      {/* Stats row */}'),
    between(bubble, "      {(freshness === 'STALE'", '      {/* Stats row */}'));
  return once(text, '          value={stats.cleanWaterDays}\n          label="Days of clean water"',
    '          value={stats.lifespanAvailable ? stats.cleanWaterDays : null}\n          label={stats.lifespanAvailable ? "Days of clean water" : "Days unavailable"}');
});
for (const p of ['artifacts/uc-companion/app/about.tsx', 'artifacts/uc-companion/app/(tabs)/index.tsx']) {
  await edit(p, text => once(text, "import ImpactBubble from '@/components/ImpactBubble';",
    "import ImpactBubble from '@/components/ImpactBubble';\nimport ReleaseStatus from '@/components/ReleaseStatus';")
    .replace('<ImpactBubble />', '<ImpactBubble />\n        <ReleaseStatus />'));
}
const config = await source('artifacts/uc-companion/app.config.js');
await edit('artifacts/uc-companion/app.config.js', () => 'module.exports = ({ config }) => {\n' +
  between(config, "  if (process.env.EAS_BUILD_PROFILE", '  return ({') +
  `  return { ...config, extra: { ...config.extra,
    companionRelease: process.env.EXPO_PUBLIC_COMPANION_BUILD_ID || process.env.EAS_BUILD_ID || 'development' } };
};\n`);
await edit('artifacts/uc-companion/app/_layout.tsx', text =>
  "import { installQueryConnectivity } from '@/lib/queryConnectivity';\n" +
  "import { nativeRecoveryDefaults } from '@/lib/nativeQueryRecovery';\n" +
  once(once(once(text, '  defaultOptions: {\n', '  defaultOptions: {\n    mutations: nativeRecoveryDefaults(Platform.OS).mutations,\n'),
    '    queries: {\n', '    queries: {\n      ...nativeRecoveryDefaults(Platform.OS).queries,\n'),
    '  useEffect(() => {\n    // React Query already handles browser visibility;',
    '  useEffect(() => installQueryConnectivity(), []);\n\n  useEffect(() => {\n    // React Query already handles browser visibility;'));
// The frozen package predates native reachability recovery. Include just its
// SDK-compatible dependency, not unrelated package/lockfile upgrades.
await edit('artifacts/uc-companion/package.json', text => {
  const value = JSON.parse(text);
  value.devDependencies['@react-native-community/netinfo'] = '12.0.1';
  return JSON.stringify(value, null, 2) + '\n';
});
const lock = await source('pnpm-lock.yaml');
function yamlBlock(text, key, indent) {
  const start = text.indexOf(' '.repeat(indent) + key + '\n');
  if (start < 0) throw new Error(`Missing lockfile entry ${key}`);
  const rest = text.slice(start);
  const boundary = rest.slice(1).search(new RegExp(`\\n {${indent}}\\S`));
  return boundary < 0 ? rest : rest.slice(0, boundary + 1);
}
await edit('pnpm-lock.yaml', text => {
  const importer = yamlBlock(lock, "'@react-native-community/netinfo':", 6);
  const packageEntry = yamlBlock(lock, "'@react-native-community/netinfo@12.0.1':", 2);
  const snapshotKey = lock.slice(lock.indexOf('snapshots:\n')).match(/^  ('@react-native-community\/netinfo@12\.0\.1[^'\n]*':)$/m)?.[1];
  if (!snapshotKey) throw new Error('Native reachability lock snapshot missing');
  const snapshot = yamlBlock(lock, snapshotKey, 2);
  if (!text.includes('react-native@0.86.3(@babel/core@7.29.7)(@types/react@19.2.17)(react@19.2.3)')) {
    throw new Error('Frozen Expo peers changed; reconcile native dependency before preparation');
  }
  const start = text.indexOf('  artifacts/uc-companion:\n');
  const end = start + text.slice(start + 1).search(/\n {2}\S/) + 1;
  const companion = text.slice(start, end);
  const updated = once(companion, "      '@react-native-async-storage/async-storage':",
    importer + "\n      '@react-native-async-storage/async-storage':");
  return once(once(once(text, companion, updated), 'packages:\n', 'packages:\n\n' + packageEntry + '\n'),
    'snapshots:\n', 'snapshots:\n\n' + snapshot + '\n');
});
const info = await source('artifacts/uc-companion/scripts/build-info.js');
await edit('artifacts/uc-companion/scripts/build-info.js', text =>
  once(text, between(text, '  const info = {', "  fs.writeFileSync"), between(info, '  const apiDomain =', '  fs.writeFileSync')));
// Frozen browser bundles stay monolithic; bundle splitting is unrelated scope.
await edit('artifacts/uc-companion/scripts/build.js', text => {
  text = "const { activateStaticBuild, stagePlatformManifest } = require('./active-static-build.cjs');\n" +
    "const { prepareStaticBuild } = require('./prepare-static-build.cjs');\n" +
    "const { preserveLegacyManifests } = require('./build-retention.js');\n" + text;
  text = once(text, between(text, 'function prepareDirectories(timestamp) {', 'function clearMetroCache()'),
    `function prepareDirectories(timestamp) {
  prepareStaticBuild(projectRoot, timestamp);
  preserveLegacyManifests(path.join(projectRoot, 'static-build'));
}\n\n`);
  text = once(text, '  const timestamp = `${Date.now()}-${process.pid}`;',
    '  const timestamp = `${Date.now()}-${process.pid}`;\n' +
    '  process.env.EXPO_PUBLIC_COMPANION_BUILD_ID = timestamp;\n  process.env.EXPO_PUBLIC_BASE_PATH = basePath;\n' +
    '  process.env.EXPO_PUBLIC_API_DOMAIN = apiDomain;\n  process.env.EXPO_PUBLIC_DOMAIN = domain;');
  text = once(text, `    fs.writeFileSync(
      path.join(projectRoot, 'static-build', platform, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );`, '    stagePlatformManifest(projectRoot, timestamp, platform, manifest);');
  return once(text, '  writeBuildInfo(projectRoot, timestamp);',
    '  writeBuildInfo(projectRoot, timestamp);\n  activateStaticBuild(projectRoot, timestamp);');
});
const serve = await source('artifacts/uc-companion/server/serve.js');
await edit('artifacts/uc-companion/server/serve.js', text => {
  text = "const { readActiveBuild } = require('../scripts/active-static-build.cjs');\n" + text;
  text = once(text, between(text, 'function serveManifest(', 'function serveLandingPage('),
    between(serve, 'function serveManifest(', 'function serveLandingPage('));
  return once(text, between(text, 'function scanForWebBundlePath()', 'function serveWebApp('),
    between(serve, 'function scanForWebBundlePath()', 'function serveWebApp('));
});
// Source-only audit: every non-allowlisted frozen byte must remain unchanged.
for (const [p, bytes] of original) {
  if (!changed.has(p) && !bytes.equals(await readFile(resolve(stage, p)))) throw new Error(`Unrelated source changed: ${p}`);
}
const finalPaths = [...new Set([...paths, ...changed])].sort();
const candidate = resolve(output, 'release-sources.tar.gz');
execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
  '-czf', candidate, '-C', stage, ...finalPaths], { maxBuffer: 40 * 1024 * 1024 });
if (!manifestBytes.equals(await readFile(manifestFile)) || !beforeArchive.equals(await readFile(archive))) {
  throw new Error('Active frozen release was modified');
}
await writeFile(resolve(output, 'candidate.json'), JSON.stringify({
  baselineSha256: digest(beforeArchive), candidateSha256: digest(await readFile(candidate)),
  changedPaths: [...changed].sort(), unchangedFrozenFiles: paths.filter(p => !changed.has(p)).length,
  productionApiOrigin: 'https://api.ucfilters.com',
  status: 'prepared-source-only-not-built-not-active-not-published',
  nativeDistribution: 'separate approval and real store destination required; OTA remains disabled',
}, null, 2) + '\n');
console.log(`Prepared source-only consistency candidate: ${candidate}`);
console.log(`Preserved ${paths.filter(p => !changed.has(p)).length} unrelated frozen files.`);
