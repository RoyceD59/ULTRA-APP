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

const { deliverStatic } = require('./static-delivery.cjs');
const { browserEntryRedirect } = require('./browser-entry.cjs');

const { isWebAppRoute, classifyWebRoute } = require('./web-routes.cjs');
const { createPublicData } = require('./public-content.cjs');
const { createPublicRenderer, renderHead, escapeHtml } = require('./public-rendering.cjs');
const { readActiveBuild } = require('../scripts/active-static-build.cjs');
const STATIC_ROOT =
  path.resolve(process.env.STATIC_ROOT || path.resolve(__dirname, '..', 'static-build'));
const TEMPLATE_PATH = path.resolve(__dirname, 'templates', 'landing-page.html');
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');
// Explicit opt-in: do not change published canonicals or renderer on merge.
const publicRenderingEnabled = process.env.PUBLIC_WEB_RENDERING_ENABLED === 'true';
const publicRenderer = publicRenderingEnabled ? createPublicRenderer({
  canonicalOrigin: process.env.PUBLIC_WEB_CANONICAL_ORIGIN,
  basePath,
  data: createPublicData(process.env.PUBLIC_WEB_API_ORIGIN),
}) : null;

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
  '.webp': 'image/webp',
  '.avif': 'image/avif',
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
  let activeBuild;
  try { activeBuild = readActiveBuild(STATIC_ROOT); }
  catch {
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'Active Companion build is unavailable' }));
    return;
  }
  const manifestPath = activeBuild
    ? path.join(STATIC_ROOT, activeBuild, platform, 'manifest.json')
    : path.join(STATIC_ROOT, platform, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, 'utf-8');
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
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

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

/**
 * Module-level cache for the web bundle path.
 *
 * `undefined`  → not yet resolved (initial state before startup scan).
 * `null`       → last scan found no bundle; will rescan on the next call.
 * `string`     → absolute path to bundle.js that existed at scan time.
 *
 * Completed new builds publish an atomic active-build pointer. It is read
 * on every request, so retained rollback files cannot pin the old release.
 * The cache/scan path remains only for older builds without that pointer.
 *
 * A cached `null` is never treated as a permanent result: a rescan is always
 * attempted so that a newly-written replacement bundle is discovered without a
 * server restart — essential for the window between old-bundle removal and
 * new-bundle arrival during a rebuild cycle.
 */
let _cachedWebBundlePath;

function scanForWebBundlePath() {
  if (!fs.existsSync(STATIC_ROOT)) return null;

  // A legacy server may start while a retained replacement is being staged.
  // Prefer the release referenced by the unchanged live native manifests over
  // the newest directory; existence alone does not mean a build is published.
  const legacyBuilds = ['ios', 'android'].flatMap(platform => {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(STATIC_ROOT, platform, 'manifest.json'), 'utf8'));
      const match = manifest.launchAsset?.key?.match(/^bundle-(\d+-\d+)$/);
      return match ? [match[1]] : [];
    } catch { return []; }
  });
  if (new Set(legacyBuilds).size === 1) {
    const legacyPath = path.join(STATIC_ROOT, legacyBuilds[0], '_expo/static/js/web/bundle.js');
    if (fs.existsSync(legacyPath)) return legacyPath;
  }

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
  try {
    const activeBuild = readActiveBuild(STATIC_ROOT);
    if (activeBuild) {
      const entry = path.join(STATIC_ROOT, activeBuild, 'web/index.html');
      _cachedWebBundlePath = fs.existsSync(entry) ? entry
        : path.join(STATIC_ROOT, activeBuild, '_expo/static/js/web/bundle.js');
      return _cachedWebBundlePath;
    }
  } catch {
    // A corrupt/incomplete pointer must not silently select some other release.
    return null;
  }
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

function serveWebApp(res, webBundlePath, pathname = '/', page = null) {
  if (!webBundlePath && !page) return false;

  const relativeBundlePath = webBundlePath ? path
    .relative(STATIC_ROOT, webBundlePath)
    .split(path.sep)
    .join('/') : '';
  const scriptUrl = `${basePath}/${relativeBundlePath}`;
  // Keep Expo's ordered runtime/shared/entry tags, but use the route-aware
  // public document and metadata rather than serving its generic index shell.
  const exported = webBundlePath && path.extname(webBundlePath) === '.html'
    ? fs.readFileSync(webBundlePath, 'utf8') : '';
  const scripts = exported
    ? (exported.match(/<script\b[^>]*\bsrc="[^"]+"[^>]*>[\s\S]*?<\/script>/gi) || []).join('')
    : webBundlePath ? `<script defer src="${escapeHtml(scriptUrl)}"></script>` : '';
  const exportStyles = exported
    ? (exported.match(/<style\b[^>]*>[\s\S]*?<\/style>|<link\b[^>]*\brel="(?:stylesheet|preload|modulepreload)"[^>]*>/gi) || []).join('')
    : '';
  const recordDocument = !!publicRenderer && /^\/(?:product|topic)\/[^/]+$/.test(pathname);
  const html = `<!doctype html>
<html lang="en"${recordDocument ? ' data-uc-record-mode' : ''}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${relativeBundlePath ? `<meta name="uc-build-id" content="${escapeHtml(relativeBundlePath.split('/')[0])}" />` : ''}
    <link rel="icon" type="image/png" href="${escapeHtml(basePath)}/favicon.png" />
    ${renderHead(page?.meta || {
      title: getAppName(),
      robots: classifyWebRoute(pathname) === 'public' ? 'index, follow' : 'noindex, follow',
    }, page?.schemas)}
    ${publicRenderer ? `<meta name="uc-public-meta-endpoint" content="${escapeHtml(basePath)}/public-page-meta" />
    <meta name="uc-public-document-path" content="${escapeHtml(pathname)}" />` : ''}
    ${exportStyles}
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
      #uc-public-content {
        position: absolute; inset: 0; overflow: auto; z-index: 1;
        background: #f7faff; color: #123047; padding: 24px;
        font: 16px/1.6 system-ui, sans-serif;
      }
      #uc-public-content main { max-width: 800px; margin: auto; }
      #uc-public-content a { color: #005d8f; }
      #uc-public-content a:focus-visible { outline: 3px solid #005d8f; outline-offset: 3px; }
      html[data-uc-record-mode], html[data-uc-record-mode] body, html[data-uc-record-mode] #root { height: auto; min-height: 100%; overflow: visible; }
      html[data-uc-record-mode] #root { height: auto; min-height: 0; flex: none; }
      #root[hidden] { display: none !important; }
      html[data-uc-record-mode] #uc-public-content { position: static; overflow: visible; padding: 24px; }
      .uc-record-document { padding: 24px; color: #123047; background: #fff; font: 16px/1.6 system-ui,sans-serif; }
      .uc-record-document main, #uc-public-content main { min-width: 0; max-width: 1000px; margin: auto; overflow-wrap: anywhere; }
      .uc-subline { font-size: 1.2rem; } .uc-price { font-size: 1.6rem; font-weight: 700; }
      .uc-warning { padding: 16px; background: #fff4dc; border-radius: 8px; }
      .uc-gallery { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,260px),1fr)); gap: 16px; }
      .uc-gallery figure { margin: 0; min-width: 0; } .uc-gallery img { width: 100%; max-height: 500px; object-fit: contain; }
      .uc-record-document details, #uc-public-content details { margin: 12px 0; border: 1px solid #dbe7ea; padding: 12px; }
      .uc-record-document summary, #uc-public-content summary { cursor: pointer; font-weight: 600; }
      #uc-public-content .uc-product-card { background: #e9f6f7; border-radius: 16px; padding: 18px; margin-block: 12px; }
      #uc-public-content section { padding-block: 24px; border-top: 1px solid #dbe7ea; }
      #uc-public-content h1, #uc-public-content h2, #uc-public-content h3 { color: #0d2a4a; }
      #uc-public-content .uc-price { font-size: 1.7rem; font-weight: 700; }
      .uc-record-document a { color: #005d8f; }
      .uc-record-document :focus-visible, #uc-public-content :focus-visible { outline: 3px solid #005d8f; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <div id="root"${recordDocument && page?.body ? ' hidden' : ''}></div>
    ${page?.body ? `<div id="uc-public-content"><main>${page.body}</main></div>` : ''}
    ${recordDocument && page?.body ? `<script id="uc-record-document" type="application/json">${require('./public-rendering.cjs').jsonScript({
      path: pathname, status: page.status, body: page.body, publicRecord: page.publicRecord || null,
    })}</script>` : ''}
    ${scripts}
    ${page?.body && webBundlePath ? `<script>
      // Works with the previous bundle as well as the enhanced client.
      // Never hide the public document until the app actually paints content.
      const root = document.getElementById('root');
      const fallback = document.getElementById('uc-public-content');
      const mounted = () => {
        if (${recordDocument ? "root.querySelector('[data-uc-record-ready]')" : "root.textContent.trim() || root.querySelector('input, img, button, [role=\"button\"]')"}) {
          fallback?.remove();
          root.removeAttribute('hidden');
          observer.disconnect();
        }
      };
      const observer = new MutationObserver(mounted);
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      mounted();
    </script>` : ''}
  </body>
</html>`;

  const status = page?.status || 200;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    ...(page?.meta.robots?.startsWith('noindex') || classifyWebRoute(pathname) !== 'public'
      ? { 'x-robots-tag': 'noindex, follow' } : {}),
  });
  res.end(html);
  return true;
}

function serveStaticFile(urlPath, req, res) {
  if (urlPath === '/favicon.png') {
    const publishedIcon = path.join(STATIC_ROOT, 'favicon.png');
    // Compatibility with the last-known-good build during rollout.
    const iconPath = fs.existsSync(publishedIcon) ? publishedIcon
      : path.resolve(__dirname, '../assets/images/icon.png');
    if (!fs.existsSync(iconPath)) return false;
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(iconPath));
    return true;
  }
  let decodedPath;
  try { decodedPath = decodeURIComponent(urlPath); } catch { return false; }
  const filePath = path.resolve(STATIC_ROOT, `.${decodedPath}`);

  if (!filePath.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  deliverStatic(req, res, filePath, contentType, urlPath);
  return true;
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
const appName = getAppName();

// Warm the legacy cache. Pointer-based releases are re-read on each request.
getWebBundlePath();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  const browserRedirect = browserEntryRedirect(req, pathname, url.search);
  if (browserRedirect) {
    res.writeHead(302, { location: browserRedirect, 'cache-control': 'no-store' });
    res.end();
    return;
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
    const buildId = webBundlePath && path.relative(STATIC_ROOT, webBundlePath).split(path.sep)[0];
    const infoPath = buildId && path.join(STATIC_ROOT, buildId, 'build-info.json');
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

  if (publicRenderer && (req.method === 'GET' || req.method === 'HEAD')) {
    // Crawler files must never be HTML fallbacks, regardless of Accept.
    if (pathname === '/robots.txt' || pathname === '/sitemap.xml') {
      try {
        const body = pathname === '/robots.txt' ? publicRenderer.robots() : await publicRenderer.sitemap();
        res.writeHead(200, {
          'content-type': pathname === '/robots.txt' ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' });
        res.end(req.method === 'HEAD' ? undefined : 'Public sitemap temporarily unavailable');
      }
      return;
    }
    if (pathname === '/public-page-meta') {
      const requested = url.searchParams.get('path') || '/';
      const clean = requested.startsWith('/') && !requested.startsWith('//')
        ? new URL(requested, 'https://local.invalid').pathname : '/__not-found';
      const route = clean.length > 1 ? clean.replace(/\/$/, '') : clean;
      const classification = classifyWebRoute(route);
      const page = classification === 'private'
        ? { status: 200, meta: { title: getAppName(), description: 'Ultra-Clear Companion account and services.', robots: 'noindex, follow' }, schemas: [] }
        : await publicRenderer.render(classification === 'public' ? route : '/__not-found');
      res.writeHead(page.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({
        meta: page.meta, schemas: page.schemas, status: page.status,
        ...(/^\/(?:product|topic)\/[^/]+$/.test(route) ? { body: page.body, publicRecord: page.publicRecord || null } : {}),
      }));
      return;
    }
  }

  if (pathname === '/' || pathname === '/manifest') {
    const platform = req.headers['expo-platform'];
    if (platform === 'ios' || platform === 'android') {
      return serveManifest(platform, res);
    }

    if (pathname === '/') {
      if (publicRenderer && !req.headers['expo-platform']) {
        const page = await publicRenderer.render('/');
        if (serveWebApp(res, webBundlePath, '/', page)) return;
      }
      if (serveWebApp(res, webBundlePath)) return;
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  // Keep direct native manifest URLs compatible without serving stale legacy
  // root files after the first pointer-based activation.
  const platformManifest = pathname.match(/^\/(ios|android)\/manifest\.json$/);
  if (platformManifest) return serveManifest(platformManifest[1], res);

  if (serveStaticFile(pathname, req, res)) return;

  // Missing versioned resources must never become public-page HTML.
  if (/\/(?:_expo|assets)\//.test(pathname)) {
    res.writeHead(404, { 'cache-control': 'no-store' });
    res.end('Not Found');
    return;
  }

  if (publicRenderer && (req.method === 'GET' || req.method === 'HEAD') && !req.headers['expo-platform']) {
    const route = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
    const classification = classifyWebRoute(route);
    if (classification === 'unknown' && !req.headers.accept?.includes('text/html')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
      res.end('Not Found');
      return;
    }
    const page = classification === 'private' ? null
      : await publicRenderer.render(classification === 'public' ? route : '/__not-found');
    if (serveWebApp(res, webBundlePath, route, page)) return;
    // Preserve no-bundle availability, but never pretend unavailable content
    // is an indexable 200 page or turn assets into HTML.
    res.writeHead(classification === 'unknown' ? 404 : 503, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, follow',
    });
    res.end(`<!doctype html><html lang="en"><head><title>Companion unavailable</title><meta name="robots" content="noindex"></head><body><h1>Companion unavailable</h1><p>Please try again shortly.</p></body></html>`);
    return;
  }

  const acceptsHtml = req.headers.accept?.includes('text/html');
  if (req.method === 'GET' && (acceptsHtml || isWebAppRoute(pathname))) {
    // Serve the web bundle when one is available; fall back to the landing page
    // when the bundle is absent (e.g. the window between old-bundle removal and
    // new-bundle arrival during a rebuild).  This prevents a blank or 404
    // response for deep-link navigations during that intermediate state.
    if (serveWebApp(res, webBundlePath, pathname)) return;
    return serveLandingPage(req, res, landingPageTemplate, appName);
  }

  res.writeHead(404, { 'cache-control': 'no-store' });
  res.end('Not Found');
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving static Expo build on port ${server.address().port}`);
});
