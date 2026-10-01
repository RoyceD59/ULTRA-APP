/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { isWebAppRoute } = require('./web-routes.cjs');

const STATIC_ROOT =
  process.env.STATIC_ROOT || path.resolve(__dirname, '..', 'static-build');
const TEMPLATE_PATH = path.resolve(__dirname, 'templates', 'landing-page.html');
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, '..', 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
    return appJson.expo?.name || 'App Landing Page';
  } catch {
    return 'App Landing Page';
  }
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, 'utf-8');
  res.writeHead(200, {
    'content-type': 'application/json',
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(
      /BUNDLE_STATUS_URL_PLACEHOLDER/g,
      `${basePath || ''}/bundle-status`,
    )
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * Module-level cache for the web bundle path.
 *
 * `undefined`  → not yet resolved (initial state before startup scan).
 * `null`       → last scan found no bundle; will rescan on the next call.
 * `string`     → absolute path to bundle.js that existed at scan time.
 *
 * The cached string path is re-validated with existsSync on each call so
 * that a rebuild (which replaces the timestamped directory) automatically
 * triggers a fresh scan rather than serving a stale, missing file.
 *
 * A cached `null` is never treated as a permanent result: a rescan is always
 * attempted so that a newly-written replacement bundle is discovered without a
 * server restart — essential for the window between old-bundle removal and
 * new-bundle arrival during a rebuild cycle.
 */
let _cachedWebBundlePath;

function scanForWebBundlePath() {
  if (!fs.existsSync(STATIC_ROOT)) return null;

  const buildDirectories = fs
    .readdirSync(STATIC_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const buildDirectory of buildDirectories) {
    const bundlePath = path.join(
      STATIC_ROOT,
      buildDirectory,
      '_expo',
      'static',
      'js',
      'web',
      'bundle.js',
    );
    if (fs.existsSync(bundlePath)) return bundlePath;
  }

  return null;
}

function getWebBundlePath() {
  // Return the cached path only when it is a non-null string that still exists
  // on disk — the common case where the bundle is stable between requests.
  if (
    _cachedWebBundlePath !== undefined &&
    _cachedWebBundlePath !== null &&
    fs.existsSync(_cachedWebBundlePath)
  ) {
    return _cachedWebBundlePath;
  }

  // Rescan when:
  //   (a) no cache yet (first request),
  //   (b) the cached file was deleted (rebuild started), or
  //   (c) the previous scan found nothing (rebuild gap).
  // This ensures a newly-written replacement bundle is picked up automatically
  // without requiring a server restart.
  _cachedWebBundlePath = scanForWebBundlePath();
  return _cachedWebBundlePath;
}

function serveWebApp(res, webBundlePath) {
  if (!webBundlePath) return false;

  const relativeBundlePath = path
    .relative(STATIC_ROOT, webBundlePath)
    .split(path.sep)
    .join('/');
  const scriptUrl = `${basePath}/${relativeBundlePath}`;
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="uc-build-id" content="${relativeBundlePath.split('/')[0]}" />
    <title>${getAppName()}</title>
    <style>
      html, body, #root {
        width: 100%;
        height: 100%;
        min-height: 100%;
        margin: 0;
      }
      #root {
        display: flex;
        flex: 1;
        min-height: 0;
        height: 100dvh;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script defer src="${scriptUrl}"></script>
  </body>
</html>`;

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
  return true;
}

function serveStaticFile(urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'content-type': contentType });
  res.end(content);
  return true;
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
const appName = getAppName();

// Warm the bundle-path cache once at startup so no request ever pays the
// filesystem scan cost.  Subsequent calls return the cached value instantly
// (or rescan only when the file has been replaced by a rebuild).
getWebBundlePath();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  if (pathname === '/status') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  const webBundlePath = getWebBundlePath();

  if (pathname === '/version.json') {
    // Resolve metadata from the SAME build as the served script, never a
    // separate latest-file pointer that could disagree during deployment.
    const infoPath = webBundlePath && path.resolve(path.dirname(webBundlePath), '../../../..', 'build-info.json');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (!infoPath || !fs.existsSync(infoPath)) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Build identification unavailable; rebuild the Companion.' }));
    } else {
      res.writeHead(200);
      res.end(fs.readFileSync(infoPath));
    }
    return;
  }

  if (pathname === '/bundle-status') {
    res.writeHead(webBundlePath ? 204 : 503, {
      'cache-control': 'no-store',
    });
    res.end();
    return;
  }

  if (pathname === '/' || pathname === '/manifest') {
    const platform = req.headers['expo-platform'];
    if (platform === 'ios' || platform === 'android') {
      return serveManifest(platform, res);
    }

    if (pathname === '/') {
      if (serveWebApp(res, webBundlePath)) return;
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  if (serveStaticFile(pathname, res)) return;

  const acceptsHtml = req.headers.accept?.includes('text/html');
  if (req.method === 'GET' && (acceptsHtml || isWebAppRoute(pathname))) {
    // Serve the web bundle when one is available; fall back to the landing page
    // when the bundle is absent (e.g. the window between old-bundle removal and
    // new-bundle arrival during a rebuild).  This prevents a blank or 404
    // response for deep-link navigations during that intermediate state.
    if (serveWebApp(res, webBundlePath)) return;
    return serveLandingPage(req, res, landingPageTemplate, appName);
  }

  res.writeHead(404, { 'cache-control': 'no-store' });
  res.end('Not Found');
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving static Expo build on port ${port}`);
});
