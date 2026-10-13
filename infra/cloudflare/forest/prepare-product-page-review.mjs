/**
 * Additive product release preparation. Never publishes or connects to a DB.
 * Existing non-product routes and predecessor rollback files are preserved.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyHandoff } from './consistency-handoff.mjs';
import { securityCenterArchive as parentArchive, SECURITY_CENTER_CANDIDATE as APPROVED_CANDIDATE } from './security-center-selection.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const review = resolve(here, 'product-page-review');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frontendRevision = '95e757f2';
// This revision precedes the guest-capability/provider integration. Buyer
// checkout prerequisites may advance; unfinished guest checkout must not.
const buyerRevision = '74ac15ab^';
const git = (revision, path) => execFileSync('git', ['show', `${revision}:${path}`],
  { cwd: root, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const parse = (path, text) => ts.createSourceFile(path, text,
  ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const names = statement => ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
  || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
  ? [statement.name?.text].filter(Boolean)
  : ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.flatMap(d => ts.isIdentifier(d.name) ? [d.name.text] : []) : [];
const identifiers = node => {
  const set = new Set();
  function visit(child) { if (ts.isIdentifier(child)) set.add(child.text); ts.forEachChild(child, visit); }
  visit(node); return set;
};
function routeKey(statement) {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return null;
  const call = statement.expression;
  if (!ts.isPropertyAccessExpression(call.expression)
    || call.expression.expression.getText() !== 'router'
    || !call.arguments[0]) return null;
  const paths = ts.isStringLiteral(call.arguments[0]) ? [call.arguments[0].text]
    : ts.isArrayLiteralExpression(call.arguments[0])
      ? call.arguments[0].elements.filter(ts.isStringLiteral).map(e => e.text) : [];
  return paths.length ? `${call.expression.name.text} ${paths.join('|')}` : null;
}
function transplantModule(parent, source, selectedNames, selectedRoutes) {
  const before = parse('module.ts', parent), after = parse('module.ts', source);
  const parentNames = new Set(before.statements.flatMap(names));
  const declarations = new Map();
  for (const statement of after.statements) for (const name of names(statement)) declarations.set(name, statement);
  const chosen = new Set(after.statements.filter(s => names(s).some(n => selectedNames.has(n))
    || (routeKey(s) && selectedRoutes.has(routeKey(s)))));
  let more = true;
  while (more) {
    more = false;
    for (const statement of [...chosen]) for (const identifier of identifiers(statement)) {
      const dependency = declarations.get(identifier);
      if (dependency && !chosen.has(dependency) && !names(dependency).includes('router')
        && (!parentNames.has(identifier) || ts.isInterfaceDeclaration(dependency) || ts.isTypeAliasDeclaration(dependency))) {
        chosen.add(dependency); more = true;
      }
    }
  }
  const existing = new Map();
  for (const statement of before.statements) {
    for (const name of names(statement)) existing.set(name, statement);
    if (routeKey(statement)) existing.set(routeKey(statement), statement);
  }
  const changes = [], additions = [];
  for (const statement of chosen) {
    const key = routeKey(statement) ?? names(statement)[0];
    const previous = existing.get(key);
    const replacement = statement.getText(after);
    if (previous) changes.push({ start: previous.getStart(before), end: previous.end, replacement });
    else additions.push(replacement);
  }
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    parent = parent.slice(0, change.start) + change.replacement + parent.slice(change.end);
  }
  const used = new Set([...chosen].flatMap(s => [...identifiers(s)]));
  // Imports must not shadow retained top-level declarations.
  const imported = new Set(before.statements.flatMap(names));
  for (const statement of before.statements) if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause?.name) imported.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) imported.add(element.name.text);
    }
  }
  const imports = [];
  for (const statement of after.statements) if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    const parts = [];
    if (clause?.name && used.has(clause.name.text) && !imported.has(clause.name.text)) {
      parts.push(clause.name.text); imported.add(clause.name.text);
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      const elements = clause.namedBindings.elements.filter(e => used.has(e.name.text) && !imported.has(e.name.text));
      if (elements.length) {
        parts.push(`{ ${elements.map(e => e.getText(after)).join(', ')} }`);
        for (const element of elements) imported.add(element.name.text);
      }
    }
    if (parts.length) imports.push(`import ${clause?.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from ${statement.moduleSpecifier.getText(after)};`);
  }
  return imports.join('\n') + '\n' + parent + '\n' + additions.join('\n\n') + '\n';
}

await verifyHandoff();
// Decode the parent using the same standard-library, regular-file-only reader
// for both comparison and deterministic archive creation.
const files = new Map(JSON.parse(execFileSync('python3', ['-c', `
import tarfile,json,base64,sys
with tarfile.open(sys.argv[1],"r:gz") as t:
 result=[]
 for m in t.getmembers():
  if m.isdir(): continue
  if not m.isfile() or m.name.startswith("/") or ".." in m.name.split("/"):
   raise ValueError("Unsafe source archive member")
  result.append([m.name,{"content":base64.b64encode(t.extractfile(m).read()).decode(),"mode":m.mode}])
 print(json.dumps(result))
`, parentArchive], { maxBuffer: 64 * 1024 * 1024 })));
const baseline = new Map([...files].map(([path, value]) => [path, { ...value }]));
const get = path => Buffer.from(files.get(path).content, 'base64').toString();
const set = (path, text) => files.set(path, {
  content: Buffer.from(text).toString('base64'), mode: files.get(path)?.mode ?? 0o644,
});
const provenance = {};
async function copy(path, revision = 'working-tree') {
  const text = revision === 'working-tree' ? await readFile(resolve(root, path)) : Buffer.from(git(revision, path));
  files.set(path, { content: text.toString('base64'), mode: files.get(path)?.mode ?? 0o644 });
  provenance[path] = revision;
}
const api = 'artifacts/api-server/';
const companion = 'artifacts/uc-companion/';
const originalUc = get(api + 'src/routes/uc.ts');
const currentUc = await readFile(resolve(root, api + 'src/routes/uc.ts'), 'utf8');
let uc = transplantModule(originalUc, currentUc,
  new Set(['hasWCCredentials', 'wcFetchArray', 'wcFetchAllPages', 'wcFetchOne', 'serverPricedLines',
    'normalizeProduct', 'wcCreateCheckoutOrder', 'getCachedCommerceCatalogue', 'invalidateCatalogueCache',
    'resolveWcCategoryId', 'getWcCategoryMap']),
  new Set(['get /uc/products', 'get /uc/products/:id', 'get /uc/products/:id/variations']));
// Product/cart contract integration uses the established buyer-only checkout,
// not later guest links or callbacks.
const buyerUc = git(buyerRevision, api + 'src/routes/uc.ts');
const buyerRoutes = new Set(parse('buyer.ts', buyerUc).statements.map(routeKey).filter(key =>
  key && /^(?:get|post|patch|delete) \/uc\/(?:checkout(?:\/|$)|orders(?:\/|$))/.test(key)));
uc = transplantModule(uc, buyerUc, new Set(['sendOrderConfirmationEmail', 'verifyPaymentOnServer']), buyerRoutes);
// Outstanding legacy provider callbacks keep their original price-validation
// contract. Only the new owned checkout uses the owned SKU/stock verifier.
const originalPricing = parse('legacy.ts', originalUc).statements.find(s =>
  ts.isFunctionDeclaration(s) && s.name?.text === 'serverPricedLines');
if (!originalPricing) throw new Error('Missing legacy pricing contract');
const legacyPricing = originalPricing.getText().replace('serverPricedLines(', 'legacyCallbackPricedLines(');
const originalLegacyFunctions = new Set(parse('legacy.ts', originalUc).statements.filter(s =>
  ts.isFunctionDeclaration(s) && s.name?.text !== 'serverPricedLines'
  && s.getText().includes('serverPricedLines(')).flatMap(names));
const ucParsed = parse('uc.ts', uc);
const legacyChanges = ucParsed.statements.filter(s => ts.isFunctionDeclaration(s)
  && originalLegacyFunctions.has(s.name?.text)).map(s => ({
    start: s.getStart(), end: s.end,
    text: s.getText().replaceAll('serverPricedLines(', 'legacyCallbackPricedLines('),
  }));
for (const change of legacyChanges.sort((a, b) => b.start - a.start)) {
  uc = uc.slice(0, change.start) + change.text + uc.slice(change.end);
}
uc += '\n' + legacyPricing + '\n';
set(api + 'src/routes/uc.ts', uc);
await copy(api + 'src/routes/payments.ts', buyerRevision);
await copy(api + 'src/routes/uc-product-records.ts');
await copy(api + 'src/lib/product-editorial.ts');
await copy(api + 'src/lib/companion-catalogue.ts');
await copy(api + 'src/lib/checkout-pricing.ts', buyerRevision);
const promotionsPath = api + 'src/lib/reward-promotions.ts';
set(promotionsPath, transplantModule(get(promotionsPath), git(buyerRevision, promotionsPath),
  new Set(['quotePromotion']), new Set()));
// Buyer fulfillment transitions and their outbox must advance together.
await copy(api + 'src/lib/order-status-pipeline.ts', buyerRevision);
const smsPath = api + 'src/lib/sms.ts';
set(smsPath, transplantModule(get(smsPath), git(buyerRevision, smsPath),
  new Set(['orderShippedSms', 'orderReadyToCollectSms', 'OrderFulfillmentDetails', 'sendSmsAwaitable']), new Set()));
await copy(api + 'src/lib/checkout-orders.ts', buyerRevision);
// The owned catalogue has no Woo fulfillment path. Stock reservations must
// match the owned buyer order rather than the old remote Woo identity.
await copy(api + 'src/lib/checkout-orders.ts');
const checkout = get(api + 'src/lib/checkout-orders.ts');
if (/guest-pay|guestPaySessions|guestPayToken/.test(checkout)) throw new Error('Buyer prerequisites unexpectedly import guest payment capability');
const referralPath = api + 'src/routes/referrals.ts';
set(referralPath, transplantModule(get(referralPath), git(buyerRevision, referralPath),
  new Set(['validateCodeForDiscount']), new Set()));
const rewardsPath = api + 'src/routes/uc-rewards.ts';
const buyerRewards = git(buyerRevision, rewardsPath);
const checkoutRoutes = new Set(parse('rewards.ts', buyerRewards).statements.map(routeKey).filter(key =>
  key && /^(?:get|post) \/uc\/checkout\//.test(key)));
set(rewardsPath, transplantModule(get(rewardsPath), buyerRewards, new Set(), checkoutRoutes));
// Extend receipt formatting while retaining the frozen mail transport.
const emailImport = parse('uc.ts', buyerUc).statements.find(s => ts.isImportDeclaration(s)
  && s.importClause?.namedBindings?.getText().includes('buildOrderReceiptEmail'));
if (!emailImport) throw new Error('Buyer receipt formatting dependency changed');
const emailPath = posix.normalize(posix.join(api + 'src/routes', emailImport.moduleSpecifier.text)).replace(/\.js$/, '.ts');
set(emailPath, transplantModule(get(emailPath), git(buyerRevision, emailPath),
  new Set(['buildOrderReceiptEmail', 'orderReceiptSerial']), new Set()));
const zodPackage = 'lib/api-zod/package.json';
const zodManifest = JSON.parse(get(zodPackage));
const currentZod = JSON.parse(await readFile(resolve(root, zodPackage), 'utf8'));
for (const entry of ['customer-contact', 'order-receipt', 'blog-inline-links-core']) {
  zodManifest.exports['./' + entry] = currentZod.exports['./' + entry];
  await copy('lib/api-zod/src/' + entry + (entry.endsWith('-core') ? '.cjs' : '.ts'));
}
set(zodPackage, JSON.stringify(zodManifest, null, 2) + '\n');

// These screens precede the unfinished Ask-to-Pay flow.
for (const path of ['app/product/[id].tsx', 'components/product/ProductRecordPage.tsx',
  'components/product/ProductCompare.tsx', 'components/product/theme.ts',
  'context/CartContext.tsx', 'context/cartStorage.ts', 'app/cart.tsx', 'app/checkout.tsx',
  'hooks/checkoutQuoteIdentity.ts', 'lib/productRecord.ts', 'lib/productAnalytics.ts']) {
  await copy(companion + path, frontendRevision);
}
// Advance only commerce methods. Retain frozen customer, session and QR APIs.
const hookPath = companion + 'hooks/useApi.ts';
let hook = get(hookPath);
const newHook = git(frontendRevision, hookPath);
const commerceMethods = new Set(['createOrder', 'quoteCheckout', 'cancelCheckout', 'getCheckoutRecovery',
  'quoteCheckoutPromotion', 'quoteReferralDiscount', 'mpesaSTKPush', 'mpesaStatus',
  'stripeSession', 'stripeSessionStatus', 'paystackInit', 'paystackVerify', 'verifyPayment']);
function returnedMethods(text) {
  const ast = parse('hook.ts', text);
  const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'useApi');
  const statement = fn.body.statements.find(s => ts.isReturnStatement(s));
  if (!statement || !ts.isObjectLiteralExpression(statement.expression)) throw new Error('Unexpected useApi return contract');
  return { ast, object: statement.expression };
}
const oldMethods = returnedMethods(hook), newMethods = returnedMethods(newHook);
const edits = [], addedMethods = [], selectedMethodNodes = [];
for (const property of newMethods.object.properties) {
  const name = property.name?.getText(newMethods.ast);
  if (!commerceMethods.has(name)) continue;
  selectedMethodNodes.push(property);
  let replacement = property.getText(newMethods.ast);
  if (name === 'quoteCheckout') {
    replacement = replacement.replace('quoteCompanionCheckout(data, { headers: authHeaders() })',
      "post<CheckoutPromotionQuote>('/api/uc/checkout/quote', data)");
  }
  const old = oldMethods.object.properties.find(p => p.name?.getText(oldMethods.ast) === name);
  if (old) edits.push({ start: old.getStart(oldMethods.ast), end: old.end, replacement });
  else addedMethods.push(replacement);
}
edits.push({ start: oldMethods.object.end - 1, end: oldMethods.object.end - 1,
  replacement: addedMethods.length ? ',\n' + addedMethods.join(',\n') : '' });
// Remove a redundant comma when the frozen object already has a trailing comma.
if (addedMethods.length && hook.slice(0, oldMethods.object.end - 1).trimEnd().endsWith(',')) {
  edits.at(-1).replacement = '\n' + addedMethods.join(',\n') + ',\n';
}
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  hook = hook.slice(0, edit.start) + edit.replacement + hook.slice(edit.end);
}
const hookDeclarations = new Set(['UCProduct', 'UCOrder', 'CheckoutPaymentInput', 'CheckoutPromotionQuote']);
for (const node of selectedMethodNodes) for (const identifier of identifiers(node)) {
  if (parse('hook.ts', newHook).statements.some(s => names(s).includes(identifier)
    && (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)))) hookDeclarations.add(identifier);
}
set(hookPath, transplantModule(hook, newHook, hookDeclarations, new Set()));
// Wishlist measurement must use only the analytics events supported by the
// frozen collector. The opt-in product adapter remains separate.
for (const path of ['app/product/[id].tsx', 'components/product/ProductRecordPage.tsx']) {
  let text = get(companion + path);
  text = text.replace(/trackEvent\('wishlist_item_(?:added|removed)', \{ productId: pid \}\);?/g, '');
  text = text.replace("trackEvent(next ? 'wishlist_item_added' : 'wishlist_item_removed', { productId: pid });", '');
  text = text.replace("getUcProduct(pid, { publicationSafe: true })", 'api.getProduct(pid)');
  set(companion + path, text);
}
// Preserve the latest fit guidance, comparison groups and colour disclaimers.
for (const path of ['components/product/ProductRecordPage.tsx', 'components/product/ProductCompare.tsx',
  'components/product/theme.ts', 'lib/productRecord.ts']) await copy(companion + path);
let productPage = get(companion + 'components/product/ProductRecordPage.tsx');
productPage = productPage.replace("import * as Clipboard from 'expo-clipboard';", '');
productPage = productPage.replace('const buyNow = (askToPay = false) => {', 'const buyNow = () => {')
  .replace('const buyNow = (askToPay = false) => {', 'const buyNow = () => {')
  .replace(/router\.push\(askToPay \?[^;]+;/, "router.push('/checkout');");
const productAst = parse('product.tsx', productPage), guestButtons = [];
function findGuestButton(node) {
  if (ts.isJsxElement(node) && node.getText().includes('buyNow(true)')) {
    let target = node;
    if (ts.isJsxExpression(node.parent)) target = node.parent;
    guestButtons.push({ start: target.getStart(), end: target.end });
  }
  ts.forEachChild(node, findGuestButton);
}
findGuestButton(productAst);
// Select the innermost button, not an enclosing whole product document.
const guestButton = guestButtons.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
if (!guestButton) throw new Error('Guest button preimage changed');
productPage = productPage.slice(0, guestButton.start) + productPage.slice(guestButton.end);
if (productPage.includes('buyNow(true)') || productPage.includes('askToPay=')) throw new Error('Guest purchase action retained');
productPage = productPage.replace('await Clipboard.setStringAsync(text);',
  `if (Platform.OS !== 'web') { await Share.share({ message: text }); return; }
    await navigator.clipboard.writeText(text);`);
productPage = productPage.replaceAll("copied ? 'Copied' : 'Copy link'",
  "copied ? 'Copied' : (Platform.OS === 'web' ? 'Copy link' : 'Share link')");
set(companion + 'components/product/ProductRecordPage.tsx', productPage);
set(companion + 'components/product/ProductRecordPage.tsx',
  get(companion + 'components/product/ProductRecordPage.tsx')
    .replace(/trackEvent\('wishlist_item_(?:added|removed)', \{ productId: pid \}\);?/g, ''));
// Keep current authored content and approved ProjectHub mappings, not old
// website images or the earlier price workbook.
for (const path of ['server/product-records.cjs', 'server/public-content.cjs',
  'server/public-schema.cjs', 'server/public-rendering.cjs', 'server/record-operations.cjs']) {
  await copy(companion + path);
}
const recordFiles = execFileSync('git', ['ls-files', '--', companion + 'server/records'],
  { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const path of recordFiles) await copy(path);
await copy(companion + 'server/serve.js', frontendRevision);
await copy(companion + 'server/web-routes.cjs', frontendRevision);
let webServer = get(companion + 'server/serve.js');
const approvedPath = '/^\\/product\\/(?:sweet-home|viva-drop|gym-buddy)\\/?$/';
webServer = webServer.replace("process.env.PUBLIC_WEB_RENDERING_ENABLED === 'true'",
  "(process.env.PUBLIC_WEB_RENDERING_ENABLED ?? 'true') === 'true'");
webServer = webServer.replace('canonicalOrigin: process.env.PUBLIC_WEB_CANONICAL_ORIGIN,',
  'canonicalOrigin: process.env.PUBLIC_WEB_CANONICAL_ORIGIN || "https://app.ucfilters.com",');
webServer = webServer.replace('createPublicData(process.env.PUBLIC_WEB_API_ORIGIN)',
  'createPublicData(process.env.PUBLIC_WEB_API_ORIGIN || "https://api.ucfilters.com")');
webServer = webServer.replaceAll('/^\\/(?:product|topic)\\/[^/]+$/', approvedPath);
// Do not activate the rest of the prepared public SEO surface.
webServer = webServer.replaceAll("if (publicRenderer && (req.method === 'GET' || req.method === 'HEAD'))",
  `if (publicRenderer && (${approvedPath}.test(pathname) || pathname === '/public-page-meta') && (req.method === 'GET' || req.method === 'HEAD'))`);
webServer = webServer.replaceAll("if (publicRenderer && (req.method === 'GET' || req.method === 'HEAD') && !req.headers['expo-platform'])",
  `if (publicRenderer && ${approvedPath}.test(pathname) && (req.method === 'GET' || req.method === 'HEAD') && !req.headers['expo-platform'])`);
// The web landing page remains the existing interactive app.
webServer = webServer.replace("if (publicRenderer && !req.headers['expo-platform'])",
  "if (false && publicRenderer && !req.headers['expo-platform'])");
webServer = webServer.replaceAll("classification === 'public' ? route : '/__not-found'",
  `${approvedPath}.test(route) ? route : '/__not-found'`);
set(companion + 'server/serve.js', webServer);
// Only the metadata hook from the feature enters the root layout; unrelated
// auth/startup changes in the feature's predecessor are not copied.
const layoutPath = companion + 'app/_layout.tsx';
let layout = get(layoutPath);
const rootLayout = git(frontendRevision, layoutPath);
if (rootLayout.includes('usePublicWebDocument();')) {
  layout = "import { usePublicWebDocument } from '@/hooks/usePublicWebDocument';\n" + layout;
  const rootFunction = parse('layout.tsx', layout).statements.find(s => ts.isFunctionDeclaration(s)
    && s.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
  if (!rootFunction?.body) throw new Error('Cannot safely insert public metadata hook');
  const at = rootFunction.body.getStart() + 1;
  layout = layout.slice(0, at) + '\n  usePublicWebDocument();\n' + layout.slice(at);
  set(layoutPath, layout);
}

// Narrow public page activation. Unapproved records retain their existing
// interactive screen, not a misleading partial new page.
let records = get(api + 'src/routes/uc-product-records.ts');
records = records.replace('const router = Router();',
  'const router = Router();\nconst approvedPageCodes = new Set(["FCT", "VDR", "GMB"]);');
records = records.replace('collection.products.map(({ imageMappings:',
  'collection.products.filter((p: any) => approvedPageCodes.has(p.code)).map(({ imageMappings:');
records = records.replace('  try { res.json(await operation(record, catalogue)); }',
  '  if (!approvedPageCodes.has(record.code)) { res.status(404).json({ error: "Product page not activated", legacy: true }); return; }\n  try { res.json(await operation(record, catalogue)); }');
if (!records.includes('Product page not activated')) throw new Error('Public activation gate preimage changed');
set(api + 'src/routes/uc-product-records.ts', records);

let routes = get(api + 'src/routes/index.ts');
routes = 'import productRecordsRouter from "./uc-product-records.js";\n' + routes;
const ucMount = routes.match(/^router\.use\([^\n]*ucRouter[^\n]*\);/m);
if (!ucMount) throw new Error('Cannot locate existing UC router mount');
routes = routes.replace(ucMount[0], `router.use(productRecordsRouter);\n${ucMount[0]}`);
set(api + 'src/routes/index.ts', routes);

let startup = get(api + 'src/index.ts');
startup = 'import { ensureProductEditorialSchema } from "./lib/product-editorial.js";\n'
  + 'import { ensureCompanionCatalogueSchema } from "./lib/companion-catalogue.js";\n' + startup;
const listenStatement = parse('startup.ts', startup).statements.find(statement => statement.getText().includes('app.listen('));
if (!listenStatement) throw new Error('API listen preimage changed');
const listen = listenStatement.getStart();
// Startup must fail before opening the health port if the paired schema cannot
// be initialized. No preparation command invokes these DB functions.
startup = startup.slice(0, listen)
  + 'await ensureProductEditorialSchema();\nawait ensureCompanionCatalogueSchema();\n'
  + startup.slice(listen);
set(api + 'src/index.ts', startup);

// Pull missing local imports only; existing unrelated source stays frozen.
// A changed product file can require a new helper without selecting the entire
// working tree. New guest/private-development modules are forbidden.
const forbidden = /(?:\/guest-pay(?:ment)?[./-]|\/dev\/|guest-pay-fixture|\/alison\/|\/field-review)/;
const queue = [...files.keys()].filter(path => files.get(path).content !== baseline.get(path)?.content);
const examined = new Set();
while (queue.length) {
  const path = queue.shift();
  if (examined.has(path) || !/\.(?:ts|tsx|js|cjs|mjs)$/.test(path)) continue;
  examined.add(path);
  const text = get(path);
  const imports = [...text.matchAll(/(?:from\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);
  for (const spec of imports) {
    let target;
    if (spec.startsWith('.')) target = posix.normalize(posix.join(posix.dirname(path), spec));
    else if (spec.startsWith('@/') && path.startsWith(companion)) target = companion + spec.slice(2);
    else continue;
    const stem = target.replace(/\.(?:js|mjs)$/, '');
    const choices = [target, stem + '.ts', stem + '.tsx', target + '.ts', target + '.tsx',
      target + '.cjs', target + '/index.ts', target + '/index.tsx'];
    let found = choices.find(choice => files.has(choice));
    if (found) continue;
    for (const choice of choices) {
      try {
        if (forbidden.test(choice)) throw new Error(`Excluded dependency: ${choice}`);
        await copy(choice, path.startsWith(companion) ? 'working-tree' : buyerRevision);
        found = choice; queue.push(choice); break;
      } catch (error) {
        if (error.message?.startsWith('Excluded dependency:')) throw error;
      }
    }
    if (!found) throw new Error(`Unresolved release dependency ${path} -> ${spec}`);
  }
}
// Pricing is now asynchronous because it verifies the owned stock/SKU at the
// transaction boundary. Preserve other callers, adding only the missing await.
for (const path of [...files.keys()].filter(p => p.startsWith(api + 'src/') && p.endsWith('.ts'))) {
  let text = get(path);
  if (!text.includes('serverPricedLines(')) continue;
  const parsed = parse(path, text), insertions = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'serverPricedLines' && !ts.isAwaitExpression(node.parent)) {
      insertions.push(node.getStart(parsed));
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const at of insertions.sort((a, b) => b - a)) text = text.slice(0, at) + 'await ' + text.slice(at);
  if (insertions.length) set(path, text);
}

// Synchronize the line-item schema used by the approved variant/cart contract.
const orderSchema = 'lib/db/src/schema/uc-orders.ts';
if (!files.has(orderSchema)) throw new Error('Unexpected predecessor order schema');
let schema = get(orderSchema);
if (!schema.includes('variationId:')) {
  const marker = 'productId: integer("product_id")';
  const at = schema.indexOf(marker, schema.indexOf('ucOrderItemsTable'));
  if (at < 0) throw new Error('Order item schema preimage changed');
  const end = schema.indexOf('\n', at);
  schema = schema.slice(0, end) + '\n  variationId: integer("variation_id"),\n'
    + '  childSku: text("child_sku"),\n  variantLabel: text("variant_label"),' + schema.slice(end);
  set(orderSchema, schema);
}

// Add the same authored server-only record contract next to the API bundle.
let build = get(api + 'build.mjs');
if (!build.includes('buildAll().catch(')) throw new Error('API build completion preimage changed');
// The asynchronous builder clears dist. Copy authored records only after that
// promise completes, otherwise a successful build silently deletes them.
build = build.replace('buildAll().catch(', 'await buildAll().catch(');
build += `
const { cpSync: copyProductFiles, mkdirSync: makeProductDirectory } = await import("node:fs");
const { resolve: productResolve, dirname: productDirname } = await import("node:path");
const { fileURLToPath: productFilePath } = await import("node:url");
const productSource = productDirname(productFilePath(import.meta.url));
const productOutput = productResolve(productSource, "dist/product-records");
makeProductDirectory(productOutput, { recursive: true });
for (const name of ["product-records.cjs", "public-schema.cjs", "records"]) {
  copyProductFiles(productResolve(productSource, "../uc-companion/server", name),
    productResolve(productOutput, name), { recursive: true });
}
`;
set(api + 'build.mjs', build);

const changedPaths = [...files.keys()].filter(path => files.get(path).content !== baseline.get(path)?.content).sort();
for (const path of changedPaths) {
  if (forbidden.test(path) || /\.env(?:\.|$)|\.whatsapp-session|artifacts\/api-server\/data\//.test(path)) throw new Error(`Disallowed source ${path}`);
}
await mkdir(review, { recursive: true });
const source = JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)));
const bytes = execFileSync('python3', ['-c', `
import sys,json,base64,tarfile,io,gzip
entries=json.load(sys.stdin); raw=io.BytesIO()
with tarfile.open(fileobj=raw,mode="w") as t:
 for path,value in entries:
  data=base64.b64decode(value["content"]); m=tarfile.TarInfo(path)
  m.size=len(data);m.mode=value["mode"];m.mtime=0
  t.addfile(m,io.BytesIO(data))
sys.stdout.buffer.write(gzip.compress(raw.getvalue(),mtime=0))
`], { input: source, maxBuffer: 32 * 1024 * 1024 });
const candidateSha256 = sha(bytes);
const scope = changedPaths.map(path => ({ path,
  beforeSha256: baseline.has(path) ? sha(Buffer.from(baseline.get(path).content, 'base64')) : null,
  afterSha256: sha(Buffer.from(files.get(path).content, 'base64')),
  source: provenance[path] ?? 'scoped-integration',
}));
await writeFile(resolve(review, 'release-sources.tar.gz'), bytes);
await writeFile(resolve(review, 'scope.json'), JSON.stringify(scope, null, 2) + '\n');
await writeFile(resolve(review, 'candidate.json'), JSON.stringify({
  parentSha256: APPROVED_CANDIDATE, candidateSha256, scopeSha256: sha(JSON.stringify(scope)),
  changedPaths, unchangedParentFiles: [...baseline].filter(([p, v]) => files.get(p)?.content === v.content).length,
  activatedPageCodes: ['FCT', 'VDR', 'GMB'], sourceFiles: files.size,
  status: 'prepared-source-only; NOT SELECTED; NOT PUBLISHED',
  ownerApprovedPrerequisites: true, selectionApproved: false, publicationApproved: false,
  schemaApplied: false, providersExercised: false,
}, null, 2) + '\n');
console.log(JSON.stringify({ candidateSha256, changedFiles: changedPaths.length,
  sourceFiles: files.size, selected: false, published: false }));
