// Keep production and disposable preview deep-link handling in lockstep.
const WEB_APP_ROUTES = new Set([
  'products', 'blog', 'support', 'map', 'account', 'ai-chat', 'care',
  'cart', 'checkout', 'enquiry', 'notification-preferences', 'orders',
  'referral', 'rewards', 'water-test',
]);
const WEB_APP_ROUTE_PREFIXES = new Set([
  'admin', 'auth', 'blog', 'guide', 'order', 'product', 'review', 'ticket',
]);

function isWebAppRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return false;
  return parts.length === 1
    ? WEB_APP_ROUTES.has(parts[0]) || WEB_APP_ROUTE_PREFIXES.has(parts[0])
    : WEB_APP_ROUTE_PREFIXES.has(parts[0]);
}

module.exports = { isWebAppRoute };
