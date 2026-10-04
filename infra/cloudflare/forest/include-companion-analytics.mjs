/**
 * Prepare the owner-approved analytics-only delta in the frozen source archive.
 * Does not build, publish, change hosting, or activate field-vitals collection.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const archive = resolve(here, 'release-sources.tar.gz');
const manifestPath = resolve(here, 'release-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const refreshing = !!manifest.companionAnalyticsPaths;
if (refreshing && process.argv[2] !== '--refresh-collector') {
  throw new Error('Analytics already packaged; use --refresh-collector only for the approved sender correction');
}
const before = await readFile(archive);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (digest(before) !== manifest.sourceArchiveSha256) throw new Error('Release archive checksum mismatch');
const revision = manifest.companionAnalyticsSourceBaseRevision ??
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const committed = execFileSync('git', ['show', `${revision}:infra/cloudflare/forest/release-sources.tar.gz`],
  { cwd: root, maxBuffer: 40 * 1024 * 1024 });
if (!refreshing && !before.equals(committed)) throw new Error('Archive must match the committed baseline before analytics preparation');
const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
if (paths.some(path => path.startsWith('/') || path.split('/').includes('..'))) throw new Error('Unsafe source path');

const changedPaths = [
  'artifacts/uc-companion/app/_layout.tsx',
  'artifacts/uc-companion/lib/analytics.ts',
  'artifacts/uc-companion/lib/umamiWeb.ts',
  'artifacts/uc-companion/lib/fieldVitalsPolicy.ts',
];
function replaceOnce(text, old, replacement) {
  if (text.split(old).length !== 2) throw new Error(`Unexpected archived source around: ${old}`);
  return text.replace(old, replacement);
}
const work = await mkdtemp(resolve(tmpdir(), 'companion-analytics-package-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', work]);
  if (!refreshing) {
  const layoutPath = resolve(work, changedPaths[0]);
  const originalLayout = await readFile(layoutPath, 'utf8');
  if (!originalLayout.includes('useEffect') || !originalLayout.includes('Platform')) {
    throw new Error('Archived layout lacks the expected web-only lifecycle primitives');
  }
  const initializer = "\n  useEffect(() => {\n    if (Platform.OS === 'web') webAnalyticsLoader.initialize();\n  }, []);";
  const layout = "import { webAnalyticsLoader } from '@/lib/umamiWeb';\n" +
    replaceOnce(originalLayout, 'export default function RootLayout() {', 'export default function RootLayout() {' + initializer);
  await writeFile(layoutPath, layout);

  const analyticsPath = resolve(work, changedPaths[1]);
  const originalAnalytics = await readFile(analyticsPath, 'utf8');
  let analytics = "import { webAnalyticsLoader } from './umamiWeb';\n" +
    replaceOnce(originalAnalytics, '  interface Window {',
      '  interface Window {\n    companionUmami?: {\n      track(name: string, data?: Record<string, unknown>): void | Promise<void>;\n    };');
  analytics = replaceOnce(analytics, 'const result = window.umami?.track(name, payload);',
    'webAnalyticsLoader.initialize();\n    const result = window.companionUmami?.track(name, payload);');
  await writeFile(analyticsPath, analytics);
  }
  for (const path of changedPaths.slice(2)) {
    await mkdir(dirname(resolve(work, path)), { recursive: true });
    await writeFile(resolve(work, path), await readFile(resolve(root, path)));
  }

  // Refuse incidental changes before producing the replacement archive.
  const oldFiles = paths.filter(path => !path.endsWith('/'));
  for (const path of oldFiles) {
    if (changedPaths.includes(path)) continue;
    const old = execFileSync('tar', ['-xOzf', archive, path], { maxBuffer: 20 * 1024 * 1024 });
    if (!old.equals(await readFile(resolve(work, path)))) throw new Error(`Unapproved release change: ${path}`);
  }
  const output = resolve(work, '.analytics.tar.gz');
  execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-czf', output, '-C', work, ...oldFiles.concat(changedPaths.filter(path => !oldFiles.includes(path))).sort()]);
  const after = await readFile(output);
  await writeFile(archive, after);
  Object.assign(manifest, {
    sourceArchiveSha256: digest(after),
    companionAnalyticsSourceBaseRevision: revision,
    companionAnalyticsSourceArchiveSha256: manifest.companionAnalyticsSourceArchiveSha256 ?? digest(before),
    companionAnalyticsPaths: changedPaths,
    companionAnalyticsScope: 'event-only; existing hosting; native no-op; no field-vitals activation; not published',
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Prepared analytics-only archive; publishing and live report verification remain pending.');
} finally {
  await rm(work, { recursive: true, force: true });
}