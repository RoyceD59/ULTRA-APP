'use strict';
const { renderGuestPayPage } = require('./guest-pay-page.cjs');
const HEADERS = {
  'cache-control': 'private, no-store, max-age=0',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
};
function createGuestPayDelivery({ basePath = '', apiOrigin, fetchImpl = fetch } = {}) {
  basePath = basePath.replace(/\/+$/, '');
  let origin;
  try {
    origin = new URL(apiOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
        origin.pathname !== '/' || origin.hash || origin.search) origin = null;
  } catch { origin = null; }
  return async function deliver(req, res, pathname) {
    const doc = /^\/pay(?:\/[^/]+)?\/?$/.test(pathname);
    const endpoint = pathname.match(/^\/guest-pay\/(summary|initialize|reconcile)$/);
    if (!doc && !endpoint) return false;
    for (const [key, value] of Object.entries(HEADERS)) res.setHeader(key, value);
    if (doc) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return true; }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      const analytics = { enabled: process.env.EXPO_PUBLIC_PRODUCT_GA_ENABLED === 'true',
        measurementId: process.env.EXPO_PUBLIC_PRODUCT_GA_MEASUREMENT_ID,
        bootstrapApproved: process.env.UC_GUEST_PAY_ANALYTICS_BOOTSTRAP_APPROVED === 'true' };
      if (analytics.enabled && analytics.bootstrapApproved && /^G-[A-Z0-9]+$/.test(analytics.measurementId || '')) {
        res.setHeader('content-security-policy', HEADERS['content-security-policy']
          .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com")
          .replace("connect-src 'self'", "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com"));
      }
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : renderGuestPayPage({ apiBase: basePath, basePath, analytics }));
      return true;
    }
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.method !== 'POST') { res.writeHead(405); res.end('{"error":"POST required"}'); return true; }
    if (!origin) { res.writeHead(503); res.end('{"error":"Payment service unavailable"}'); return true; }
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > 8192) throw new Error('Too large');
      }
      const body = JSON.parse(raw);
      const response = await fetchImpl(new URL(`/api/guest-pay/${endpoint[1]}`, origin), {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ token: body.token, method: body.method, email: body.email, phone: body.phone }),
        redirect: 'error', signal: AbortSignal.timeout(35000),
      });
      res.writeHead(response.status);
      res.end(await response.text());
    } catch {
      res.writeHead(503);
      res.end('{"error":"Payment status unavailable. Do not start another charge."}');
    }
    return true;
  };
}
module.exports = { createGuestPayDelivery, HEADERS };
