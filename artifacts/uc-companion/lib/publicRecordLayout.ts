/** Public HTML owns natural flow only until this exact route's app is ready.
 * A retained, hidden stack screen must not count as the current route.
 */
export function syncPublicRecordLayout(pathname: string, doc: Document) {
  const recordRoute = /^\/(?:product|topic)\/[^/]+$/.test(pathname);
  const ready = Array.from(doc.querySelectorAll('[data-uc-interactive-record-ready]'))
    .some(node => node.getAttribute('data-uc-interactive-record-ready') === pathname);
  const fallback = doc.getElementById('uc-public-content');
  const publicDocumentOwnsLayout = recordRoute && !ready && !!fallback;
  doc.documentElement.toggleAttribute('data-uc-record-mode', publicDocumentOwnsLayout);
  if (!publicDocumentOwnsLayout) {
    doc.getElementById('uc-public-content')?.remove();
    doc.getElementById('root')?.removeAttribute('hidden');
  }
}
