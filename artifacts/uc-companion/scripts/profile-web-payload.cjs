/**
 * Source-map inventory for the scripts actually requested at Home.
 * Export with --source-maps, then run measure-loading.cjs first.
 * node scripts/profile-web-payload.cjs /tmp/export /tmp/timings.json /tmp/profile.json
 * Add --assert-phone-graph for the release phone guard (independent of --assert-companion-only).
 * Source bytes rank graph costs; they are NOT attributed minified byte sizes.
 */
const fs = require('node:fs');
const path = require('node:path');

function portableSource(source) {
  const normalized = source.replace(/\\/g, '/');
  return normalized.includes('/node_modules/')
    ? normalized.split('/node_modules/').pop() : normalized;
}

function readMap(filename) {
  const map = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Array.isArray(map.sources) || !map.sources.length ||
      map.sources.some(source => typeof source !== 'string')) {
    throw new Error(`Missing source inventory in ${filename}`);
  }
  return map;
}

function packageName(source) {
  source = source.replace(/\\/g, '/');
  const relative = source.split('/node_modules/').pop();
  if (relative === source) return 'workspace';
  return relative.split('/').slice(0, relative.startsWith('@') ? 2 : 1).join('/');
}

function profilePayload(directory, initialScripts) {
  if (!Array.isArray(initialScripts) || !initialScripts.length) {
    throw new Error('No initially requested scripts; collect a fresh browser inventory');
  }
  if (initialScripts.some(script => typeof script.name !== 'string' ||
      !/^[^/\\]+\.js$/.test(script.name)) ||
      new Set(initialScripts.map(script => script.name)).size !== initialScripts.length) {
    throw new Error('Initial script inventory must contain unique exported JS filenames');
  }
  const totals = {};
  const chunks = initialScripts.map(script => {
    const map = readMap(path.join(directory, '_expo/static/js/web', `${script.name}.map`));
    const packages = {};
    const modules = map.sources.map((source, index) => {
      const bytes = Buffer.byteLength(map.sourcesContent?.[index] || '');
      const name = packageName(source);
      packages[name] = (packages[name] || 0) + bytes;
      totals[name] = (totals[name] || 0) + bytes;
      // Strip machine-specific pnpm virtual-store paths for portable reports.
      return { source: portableSource(source), sourceBytes: bytes };
    });
    return { ...script, packages, modules: modules.sort((a, b) => b.sourceBytes - a.sourceBytes) };
  });
  const apiModules = chunks.flatMap(chunk => chunk.modules)
    .filter(module => /lib\/api-client-react\/src\//.test(module.source));
  const legacyApiModules = apiModules.filter(module =>
    /\/generated\/api(?:\.schemas)?\.ts$/.test(module.source));
  return {
    note: 'Source bytes describe the graph, not minified/encoded cost. Initial script sizes come from browser requests.',
    initialBytes: chunks.reduce((sum, chunk) => {
      for (const key of ['raw', 'gzip', 'brotli']) sum[key] += chunk[key];
      return sum;
    }, { raw: 0, gzip: 0, brotli: 0 }),
    packages: Object.entries(totals).sort((a, b) => b[1] - a[1])
      .map(([name, sourceBytes]) => ({ name, sourceBytes })),
    apiClient: {
      sourceBytes: apiModules.reduce((sum, module) => sum + module.sourceBytes, 0),
      modules: apiModules,
      legacyApiModules: legacyApiModules.map(module => module.source),
    },
    chunks,
  };
}

function assertCompanionOnly(report) {
  if (!report.apiClient.modules.length) throw new Error('No API client modules found; check source maps');
  if (report.apiClient.legacyApiModules.length) {
    throw new Error(`Initial scripts still contain the team API barrel: ${report.apiClient.legacyApiModules.join(', ')}`);
  }
}

// Match module paths, not source text: the generated facade's banner mentions
// libphonenumber-js, and ordinary PhoneNumber formatting is deliberately retained.
const unusedPhoneModule = /^libphonenumber-js\/.*(?:\/|^)(?:AsYouType[^/]*|PhoneNumberMatcher[^/]*|findNumbers|searchNumbers|findPhoneNumbers[^/]*|searchPhoneNumbers[^/]*)(?:\/|\.|$)/;
const phoneSources = {
  facade: /(?:^|\/)lib\/api-zod\/src\/phone-runtime\.js$/,
  phone: /(?:^|\/)lib\/api-zod\/src\/phone\.ts$/,
  identity: /(?:^|\/)lib\/api-zod\/src\/instant-water-identity\.ts$/,
  checkout: /(?:^|\/)app\/checkout\.tsx$/,
  registration: /(?:^|\/)app\/auth\/register\.tsx$/,
};

function runtimeImports(content) {
  // Read real syntax, not comments or type-only imports in sourcesContent.
  const ts = require('typescript');
  const source = ts.createSourceFile('module.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      const names = bindings && ts.isNamedImports(bindings)
        ? bindings.elements.filter(binding => !binding.isTypeOnly)
          .map(binding => (binding.propertyName || binding.name).text) : [];
      if (!bindings || !ts.isNamedImports(bindings) || names.length) {
        imports.push({ from: node.moduleSpecifier.text, names });
      }
    }
    if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') &&
        node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
      imports.push({ from: node.arguments[0].text, names: [] });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

function assertPhoneGraph(report, directory) {
  const forbidden = report.chunks.flatMap(chunk => chunk.modules
    .filter(module => unusedPhoneModule.test(module.source))
    .map(module => `${chunk.name}: ${module.source}`));
  if (forbidden.length) {
    throw new Error(`Unused phone formatting/search modules in initial scripts:\n${forbidden.join('\n')}`);
  }
  const web = path.join(directory, '_expo/static/js/web');
  const scripts = fs.readdirSync(web).filter(name => name.endsWith('.js')).sort();
  for (const chunk of report.chunks) {
    if (!scripts.includes(chunk.name)) throw new Error(`Initial script is missing from export: ${chunk.name}`);
  }
  // Include deferred routes: checkout and registration are normally not requested
  // on Home. Every emitted script needs its matching map, or proof is incomplete.
  const found = Object.fromEntries(Object.keys(phoneSources).map(key => [key, []]));
  for (const script of scripts) {
    const map = readMap(path.join(web, `${script}.map`));
    map.sources.forEach((source, index) => {
      const portable = portableSource(source);
      for (const [key, pattern] of Object.entries(phoneSources)) {
        if (!pattern.test(portable)) continue;
        const content = map.sourcesContent?.[index];
        if (typeof content !== 'string' || !content.trim()) {
          throw new Error(`Missing phone graph source content: ${script}: ${portable}`);
        }
        found[key].push({ script, source: portable, content });
      }
    });
  }
  for (const [key, modules] of Object.entries(found)) {
    if (modules.length !== 1) {
      throw new Error(`Expected one shared ${key} module in exported web graph; found ${modules.length}`);
    }
  }
  if (!report.chunks.some(chunk => chunk.name === found.facade[0].script)) {
    throw new Error('Shared phone facade is absent from the initial script inventory');
  }
  const imports = Object.fromEntries(Object.entries(found)
    .filter(([key]) => key !== 'facade').map(([key, modules]) => [key, runtimeImports(modules[0].content)]));
  for (const key of ['checkout', 'registration']) {
    if (!imports[key].some(item => item.from === '@workspace/api-zod/instant-water-identity' &&
        ['normalizeInstantPhone', 'isValidInstantPhone'].every(name => item.names.includes(name)))) {
      throw new Error(`${key} no longer uses the shared instant-water phone helpers`);
    }
  }
  for (const key of ['phone', 'identity']) {
    if (!imports[key].some(item => item.from === './phone-runtime.js' &&
        item.names.includes('parsePhoneNumberFromString'))) {
      throw new Error(`${key} no longer uses the shared phone facade`);
    }
  }
  // Refuse runtime barrel imports in these consumers, while allowing upstream
  // type-only imports. Initial-map inspection also catches bypasses elsewhere.
  for (const key of ['phone', 'identity', 'checkout', 'registration']) {
    if (imports[key].some(item => /^libphonenumber-js(?:\/|$)/.test(item.from))) {
      throw new Error(`${key} bypasses the phone facade with a runtime libphonenumber-js import`);
    }
  }
  return {
    checkedInitialScripts: report.chunks.map(chunk => chunk.name),
    checkedExportedScripts: scripts.length,
    unusedInitialModules: [],
    sharedModules: Object.fromEntries(Object.entries(found).map(([key, modules]) =>
      [key, { script: modules[0].script, source: modules[0].source }])),
  };
}

module.exports = { packageName, profilePayload, assertCompanionOnly, assertPhoneGraph };
if (require.main === module) {
  const timings = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const report = profilePayload(process.argv[2], timings[0].initialScripts);
  if (process.argv.includes('--assert-phone-graph')) {
    report.phoneGraph = assertPhoneGraph(report, process.argv[2]);
  }
  fs.writeFileSync(process.argv[4], JSON.stringify(report, null, 2));
  if (process.argv.includes('--assert-companion-only')) assertCompanionOnly(report);
  console.log(report.initialBytes);
  console.table(report.packages.slice(0, 20));
}