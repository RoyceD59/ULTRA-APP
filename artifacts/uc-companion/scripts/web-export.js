const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const zlib = require('node:zlib');

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(filename) : [filename];
  });
}

// Keep the router's base URL unchanged. Only resource URLs gain the build ID,
// so deep links and dynamically imported chunks both work through the proxy.
function pairWebResources(directory, basePath, buildId) {
  const prefix = basePath.replace(/\/+$/, '');
  const resourcePrefix = `${prefix}/${buildId}/web`;
  for (const filename of walkFiles(directory)) {
    if (!/\.(js|html|css)$/.test(filename)) continue;
    let text = fs.readFileSync(filename, 'utf8');
    for (const folder of ['_expo', 'assets']) {
      text = text.split(`${prefix}/${folder}/`).join(`${resourcePrefix}/${folder}/`);
    }
    fs.writeFileSync(filename, text);
  }
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  if (!html.includes(`${resourcePrefix}/_expo/static/js/web/`)) {
    throw new Error('Web export did not produce version-paired entry scripts');
  }
  const chunks = walkFiles(directory).filter(file => /\/_expo\/static\/js\/web\/.*\.js$/.test(file));
  if (chunks.length < 2) throw new Error('Web export unexpectedly produced a monolithic bundle');
  console.log(`Exported ${chunks.length} web entry/route/shared chunks`);
}

async function exportWeb(projectRoot, buildId, basePath, env, outputRoot = projectRoot) {
  const directory = path.join(outputRoot, 'static-build', buildId, 'web');
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', [
      'exec', 'expo', 'export', '--platform', 'web', '--output-dir', directory, '--clear',
    ], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...env, CI: '1', UC_WEB_EXPORT_BASE_PATH: basePath || '/', EXPO_NO_BUNDLE_SPLITTING: '0' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Web export failed (${code})`)));
  });
  pairWebResources(directory, basePath, buildId);
}

function precompressAssets(directory) {
  for (const filename of walkFiles(directory)) {
    if (!/\.(js|css|html|json|svg|ttf|otf)$/.test(filename)) continue;
    const bytes = fs.readFileSync(filename);
    fs.writeFileSync(`${filename}.gz`, zlib.gzipSync(bytes, { level: 9 }));
    fs.writeFileSync(`${filename}.br`, zlib.brotliCompressSync(bytes, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 },
    }));
  }
}

module.exports = { exportWeb, pairWebResources, precompressAssets, walkFiles };