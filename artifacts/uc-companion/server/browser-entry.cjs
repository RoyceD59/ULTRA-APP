// API CORS and published assets support this canonical app origin, not the
// deployment alias. Redirect HTML only; native manifests/assets stay reachable.
const APP_HOST = 'app.ucfilters.com';

function browserEntryRedirect(req, pathname, search) {
  if (req.method !== 'GET' || !req.headers.accept?.includes('text/html')) return null;
  if (req.headers['expo-platform']) return null;
  if (pathname === '/status' || pathname === '/bundle-status' || pathname === '/manifest') return null;
  if (/^\/\d+-\d+\//.test(pathname)) return null;

  // Cloudflare explicitly carries the public hostname across Replit's proxy.
  const hosts = [
    req.headers['x-uc-public-host'],
    req.headers['x-forwarded-host'],
    req.headers.host,
  ];
  if (hosts.includes(APP_HOST)) return null;
  if (!hosts.some(host => typeof host === 'string' && /^[a-z0-9-]+\.replit\.app$/i.test(host))) return null;

  // Destination is fixed, never derived from untrusted Host/forwarded headers.
  return `https://${APP_HOST}${pathname}${search}`;
}

module.exports = { APP_HOST, browserEntryRedirect };