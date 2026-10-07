// Keep production and disposable preview deep-link handling in lockstep.
const WEB_APP_ROUTES = new Set([
  'products', 'blog', 'support', 'map', 'account', 'ai-chat', 'care',
  'cart', 'checkout', 'enquiry', 'notification-preferences', 'orders',
  'referral', 'rewards', 'water-test', 'about', 'hydration',
]);
const WEB_APP_ROUTE_PREFIXES = new Set([
  'admin', 'auth', 'blog', 'guide', 'order', 'product', 'topic', 'review', 'ticket',
]);

function isWebAppRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return false;
  return parts.length === 1
    ? WEB_APP_ROUTES.has(parts[0]) || WEB_APP_ROUTE_PREFIXES.has(parts[0])
    : WEB_APP_ROUTE_PREFIXES.has(parts[0]);
}

const PUBLIC_ROUTES = new Set(Object.keys(require('../data/public-pages.json')));
function classifyWebRoute(pathname) {
  const route = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (PUBLIC_ROUTES.has(route) || /^\/(product|topic|blog|guide)\/[^/]+$/.test(route)) return 'public';
  if (/^\/(product|topic|blog|guide)(\/|$)/.test(route)) return 'unknown';
  if (isWebAppRoute(route)) return 'private';
  return 'unknown';
}

module.exports = { isWebAppRoute, classifyWebRoute };