/**
 * Build a source-only candidate from the existing frozen release plus the
 * linked-offline-registration delta. This deliberately does NOT replace the
 * approved archive, release manifest, .prepared marker, hosting or activation.
 * All unrelated frozen files remain byte-for-byte unchanged.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const output = resolve(root, '.offline-filter-release');
const manifest = JSON.parse(await readFile(resolve(here, 'release-manifest.json'), 'utf8'));
const archive = resolve(here, 'release-sources.tar.gz');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(await readFile(archive)) !== manifest.sourceArchiveSha256) throw new Error('Frozen archive checksum mismatch');
const paths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(p => p && !p.endsWith('/'));
if (paths.some(p => p.startsWith('/') || p.split('/').includes('..'))) throw new Error('Unsafe archive path');
await mkdir(output, { recursive: true });
const stage = resolve(output, 'source');
await rm(stage, { recursive: true, force: true }); // Disposable candidate only.
await mkdir(stage);
execFileSync('tar', ['-xzf', archive, '-C', stage]);
const original = new Map(await Promise.all(paths.map(async p => [p, await readFile(resolve(stage, p))])));
const changed = new Set();
const source = p => readFile(resolve(root, p), 'utf8');
function once(text, old, next) {
  if (text.split(old).length !== 2) throw new Error(`Unexpected frozen source near: ${old}`);
  return text.replace(old, () => next);
}
function between(text, start, end) {
  const from = text.indexOf(start), to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing scoped fragment: ${start}`);
  return text.slice(from, to);
}
async function edit(p, fn) {
  await writeFile(resolve(stage, p), fn(await readFile(resolve(stage, p), 'utf8')));
  changed.add(p);
}
async function add(p) {
  if (original.has(p)) throw new Error(`New source already exists: ${p}`);
  await mkdir(dirname(resolve(stage, p)), { recursive: true });
  await writeFile(resolve(stage, p), await source(p));
  changed.add(p);
}
// Fixed preimages and approved replacements survive a merge/HEAD change and
// refuse to copy later unrelated edits into this narrowly prepared release.
for (const [p, beforeHash, approvedHash] of [
  ['artifacts/api-server/src/lib/offline-provisioning.ts', '89d6e3fa61d4b7b51d8da1397653fc9d6580dee75c1afc1d51595e20bfb5814a', '6e7ee065d659a4d6d44a792f5d066213048e6e5d6c6cb162cd0d2ec8679949c6'],
  ['artifacts/api-server/src/routes/uc-offline-clients.ts', '8e71d5cd22fc1b73970fb7def05146bf50565be1cde4b3d674cfc9fe42a8fb53', 'a387ca93ae138efd1ef03e893591cfe6c41377086c348c5f8c59a56f88722d71'],
]) {
  if (!original.has(p) || hash(original.get(p)) !== beforeHash || hash(await readFile(resolve(root, p))) !== approvedHash)
    throw new Error(`Reconcile and approve changed frozen scope first: ${p}`);
  await writeFile(resolve(stage, p), await source(p));
  changed.add(p);
}
for (const p of [
  'artifacts/api-server/src/lib/offline-purchases.ts',
  'artifacts/uc-companion/components/OfflinePurchasesSection.tsx',
  'lib/db/migrations/0065_offline_filter_registration.sql',
]) await add(p);

const routes = await source('artifacts/api-server/src/routes/uc.ts');
const offlineRoutes = between(routes, 'router.get("/uc/purchases/offline"', '\n//\n// A customer');
await edit('artifacts/api-server/src/routes/uc.ts', text =>
  'import { listOfflinePurchases, registerOfflinePurchase, OfflinePurchaseError } from "../lib/offline-purchases.js";\n' +
  once(text, '// POST /api/uc/filters/register-purchase', offlineRoutes + '\n// POST /api/uc/filters/register-purchase'));
const ddl = await source('lib/db/migrations/0065_offline_filter_registration.sql');
await edit('artifacts/api-server/src/index.ts', text => once(text,
  '  logger.info("Startup migration: registered filter purchase source ownership ensured");',
  `  await pool.query(${JSON.stringify(ddl)});\n  logger.info("Startup migration: registered filter purchase source ownership ensured");`));
await edit('lib/db/src/schema/uc-offline-clients.ts', text => once(text,
  'export interface OfflineProduct {',
  'export interface OfflineProduct {\n  lineId?: string;\n  unitIds?: string[];'));
await edit('lib/db/src/schema/uc-registered-filters.ts', text => {
  text = once(text, '  sourceOrderId: integer("source_order_id"),',
    '  sourceOrderId: integer("source_order_id"),\n  offlineSaleId: integer("offline_sale_id"),\n  offlineUnitId: text("offline_unit_id"),\n  offlineLifespanDays: integer("offline_lifespan_days"),');
  return once(text, '}, (t) => [', '}, (t) => [\n  uniqueIndex("uc_registered_filters_offline_unit_unique").on(t.offlineUnitId),');
});
await edit('artifacts/projecthub/src/pages/impact.tsx', text => {
  text = once(text, 'interface OfflineProduct {', 'interface OfflineProduct {\n  lineId?: string;');
  return once(text, 'j === i ? updated : p', 'j === i ? { ...updated, lineId: p.lineId } : p');
});

const api = await source('artifacts/uc-companion/hooks/useApi.ts');
await edit('artifacts/uc-companion/hooks/useApi.ts', text => {
  text = once(text, 'export interface RegisterPurchaseResult {',
    between(api, 'export interface OfflinePurchaseItem {', 'export interface RegisterPurchaseResult {') + 'export interface RegisterPurchaseResult {');
  return once(text, '    registerFilterPurchase:', between(api, '    getOfflinePurchases:', '    registerFilterPurchase:') + '    registerFilterPurchase:');
});
await edit('artifacts/uc-companion/hooks/useNotifications.ts', text => {
  text = once(text, '  sourceOrderId?: number;', '  sourceOrderId?: number;\n  registeredFilterId?: number;\n  offlineUnitId?: string;');
  return once(text, '    sourceOrderId:   existing.sourceOrderId,',
    '    sourceOrderId:   existing.sourceOrderId,\n    registeredFilterId: existing.registeredFilterId,\n    offlineUnitId: existing.offlineUnitId,');
});
const tracker = await source('artifacts/uc-companion/components/FilterTrackerSection.tsx');
await edit('artifacts/uc-companion/lib/filterRegistrationCommit.ts', () =>
  `/**
 * Commit the durable owned source before scheduling or showing local state.
 * Existing receipt callbacks may ignore the committed value.
 */
export async function commitPurchaseBackedRegistration<T, C>(
  commitPurchase: () => Promise<C>,
  scheduleReminders: (committed: C) => Promise<T>,
  showRegisteredActivation: (activation: T) => void,
): Promise<T> {
  const committed = await commitPurchase();
  const activation = await scheduleReminders(committed);
  showRegisteredActivation(activation);
  return activation;
}
`);
await edit('artifacts/uc-companion/components/FilterTrackerSection.tsx', text => {
  text = once(text, 'type RegisterPurchaseItem }', 'type RegisterPurchaseItem, type OfflinePurchaseItem }');
  text = once(text, 'interface ModalProps {', 'interface ModalProps {\n  offlineSelection?: { saleId: number; saleDate: string; item: OfflinePurchaseItem; unitId: string; registeredInstallationDate?: string } | null;');
  text = once(text, '  initialProductId = null, initialDayOffset = 0,', '  initialProductId = null, initialDayOffset = 0,\n  offlineSelection = null,');
  text = once(text, '  const [saving, setSaving]     = useState(false);',
    between(tracker, '  const [saving, setSaving]     = useState(false);', '  // ── Receipt-based'));
  text = once(text, '  function handleClose() { reset(); onClose(); }',
    between(tracker, '  async function handleOfflineSave()', '  return (\n    <Modal'));
  text = once(text, "{purchase ? 'Select Your Filter' : 'Register with Receipt'}",
    "{offlineSelection ? 'Register Offline Filter' : purchase ? 'Select Your Filter' : 'Register with Receipt'}");
  return once(text, '          {purchase === null ? (',
    between(tracker, '          {offlineSelection ? (', '          ) : purchase === null ? (') + '          ) : purchase === null ? (');
});
await edit('artifacts/uc-companion/app/(tabs)/account.tsx', text => {
  text = "import OfflinePurchasesSection from '@/components/OfflinePurchasesSection';\n" + text;
  text = once(text, '<PersonalImpactSection key={user.id}', '<PersonalImpactSection key={`personal-impact:${user.id}`}');
  text = once(text, '          <FilterTrackerSection\n', '          <FilterTrackerSection key={`water-tests:${user.id}`}\n');
  return once(text, '          {/* Filter tracker */}', `          <OfflinePurchasesSection key={\`offline-purchases:\${user.id}\`} userId={user.id}
            focused={accountFocused} onRegistered={a => {
              setFilterActivation(a); refreshNotifStatus();
              void queryClient.invalidateQueries({ queryKey: customerQueryKeys.rewards(user.id) });
            }} />
          {/* Filter tracker */}`);
});
const spec = await source('lib/api-spec/openapi.yaml');
await edit('lib/api-spec/openapi.yaml', text => {
  text = once(text, 'paths:\n', 'paths:\n' + between(spec, '  /uc/purchases/offline:', '  /uc/customer/rewards/qr/validate:'));
  return once(text, '  schemas:\n', '  schemas:\n' +
    between(spec, '    CustomerOfflinePurchaseList:', '    UcOfflineClientInput:'));
});
// Enforce the packaging boundary rather than assuming the file allowlist suffices.
for (const [p, bytes] of original) {
  if (!changed.has(p) && !bytes.equals(await readFile(resolve(stage, p)))) throw new Error(`Unrelated source changed: ${p}`);
}
const finalPaths = [...new Set([...paths, ...changed])].sort();
const candidate = resolve(output, 'release-sources.tar.gz');
execFileSync('tar', ['-czf', candidate, '-C', stage, ...finalPaths], { maxBuffer: 40 * 1024 * 1024 });
await writeFile(resolve(output, 'candidate.json'), JSON.stringify({
  baselineSha256: manifest.sourceArchiveSha256, candidateSha256: hash(await readFile(candidate)),
  changedPaths: [...changed].sort(), status: 'prepared-only-not-active-not-published',
}, null, 2));
console.log(`Prepared source-only offline-registration candidate: ${candidate}`);
console.log(`Preserved ${paths.length - [...changed].filter(p => original.has(p)).length} unrelated frozen files.`);