/**
 * Source-map inventory for the scripts actually requested at Home.
 * Export with --source-maps, then run measure-loading.cjs first.
 * node scripts/profile-web-payload.cjs /tmp/export /tmp/timings.json /tmp/profile.json
 * Source bytes rank graph costs; they are NOT attributed minified byte sizes.
 */
const fs = require('node:fs');
const path = require('node:path');

function packageName(source) {
  const relative = source.split('/node_modules/').pop();
  if (relative === source) return 'workspace';
  return relative.split('/').slice(0, relative.startsWith('@') ? 2 : 1).join('/');
}

function profilePayload(directory, initialScripts) {
  const totals = {};
  const chunks = initialScripts.map(script => {
    const map = JSON.parse(fs.readFileSync(
      path.join(directory, '_expo/static/js/web', `${script.name}.map`), 'utf8'));
    const packages = {};
    const modules = map.sources.map((source, index) => {
      const bytes = Buffer.byteLength(map.sourcesContent?.[index] || '');
      const name = packageName(source);
      packages[name] = (packages[name] || 0) + bytes;
      totals[name] = (totals[name] || 0) + bytes;
      // Strip machine-specific pnpm virtual-store paths for portable reports.
      return { source: source.includes('/node_modules/')
        ? source.split('/node_modules/').pop() : source, sourceBytes: bytes };
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

module.exports = { packageName, profilePayload, assertCompanionOnly };
if (require.main === module) {
  const timings = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const report = profilePayload(process.argv[2], timings[0].initialScripts);
  fs.writeFileSync(process.argv[4], JSON.stringify(report, null, 2));
  if (process.argv.includes('--assert-companion-only')) assertCompanionOnly(report);
  console.log(report.initialBytes);
  console.table(report.packages.slice(0, 20));
}