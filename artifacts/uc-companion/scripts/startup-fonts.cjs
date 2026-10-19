/** Network-body evidence, not a list of files bundled or fonts in document.fonts. */
const fs = require('node:fs');
const path = require('node:path');

const FONT_URL = /\.(?:ttf|otf|woff2?)(?:[?#]|$)/i;
const FONT_MIME = /^(?:font\/|application\/(?:x-font-|font-|vnd\.ms-fontobject))/i;
const isFontRequest = request => request.resourceType() === 'font' || FONT_URL.test(request.url());

// Exact Expo asset names (with optional content hash), NOT all vector-icons.
// Ionicons: tab navigation and screen icons. Feather: ErrorFallback controls.
const ICON_ALLOWLIST = [
  { family: 'Ionicons', asset: /^Ionicons(?:\.[a-f0-9]{32})?\.ttf$/, consumer: 'app/(tabs)/_layout.tsx' },
  { family: 'Feather', asset: /^Feather(?:\.[a-f0-9]{32})?\.ttf$/, consumer: 'components/ErrorFallback.tsx' },
];

function inspectFonts(fonts) {
  return fonts.map(font => {
    const asset = path.basename(decodeURIComponent(new URL(font.url).pathname));
    const allowed = ICON_ALLOWLIST.find(entry => entry.asset.test(asset));
    return {
      ...font, asset, allowed: !!allowed, family: allowed?.family || null,
      consumer: allowed?.consumer || null,
      review: allowed ? null : 'Review this download against actual fontFamily consumers; do not allowlist an unused root registration.',
    };
  });
}

function fontFamilyConsumers(root) {
  const matches = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(filename);
      } else if (/\.[jt]sx?$/.test(entry.name)) {
        fs.readFileSync(filename, 'utf8').split('\n').forEach((line, index) => {
          if (/\bfontFamily\b/.test(line)) matches.push({
            file: path.relative(root, filename).split(path.sep).join('/'), line: index + 1, source: line.trim(),
          });
        });
      }
    }
  }
  for (const directory of ['app', 'components', 'constants', 'context', 'hooks', 'lib']) {
    if (fs.existsSync(path.join(root, directory))) walk(path.join(root, directory));
  }
  return matches;
}

function observeFonts(page) {
  const records = new Map();
  const reads = new Set();
  const start = Date.now();
  const record = request => {
    if (!records.has(request)) records.set(request, {
      url: request.url(), startedMs: Date.now() - start, bodyBytes: null,
      status: null, complete: false, error: null,
    });
    return records.get(request);
  };
  const onRequest = request => { if (isFontRequest(request)) record(request); };
  const onResponse = response => {
    if (isFontRequest(response.request()) || FONT_MIME.test(response.headers()['content-type'] || '')) {
      record(response.request()).status = response.status();
    }
  };
  const onFinished = request => {
    if (!records.has(request)) return;
    const entry = record(request);
    const read = (async () => {
      try {
        const response = await request.response();
        entry.bodyBytes = (await response.body()).length;
        if (!response.ok()) entry.error = `HTTP ${response.status()}`;
      } catch (error) { entry.error = error.message; }
      entry.complete = true;
      entry.finishedMs = Date.now() - start;
    })();
    reads.add(read);
    read.finally(() => reads.delete(read));
  };
  const onFailed = request => {
    if (!records.has(request) && !isFontRequest(request)) return;
    Object.assign(record(request), {
      complete: true, error: request.failure()?.errorText || 'Request failed',
      finishedMs: Date.now() - start,
    });
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);
  return {
    async report() {
      await Promise.all([...reads]);
      return inspectFonts([...records.values()]);
    },
    stop() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed);
    },
  };
}

module.exports = { ICON_ALLOWLIST, isFontRequest, inspectFonts, fontFamilyConsumers, observeFonts };
