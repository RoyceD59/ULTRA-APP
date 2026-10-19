const { publicUrl } = require('./public-schema.cjs');
const { PublicDataError } = require('./public-content.cjs');

// SKU equality only. Names, ordering, old IDs and similarly named mock products
// are never identity evidence. A variant must declare its real parent ID.
function resolveIdentity(identity, inventory) {
  const parents = inventory.filter(p => p.sku === identity.parentSku);
  const variants = inventory.filter(p => identity.variants.includes(p.sku));
  const parentIds = new Set([...parents.map(p => Number(p.id)),
    ...variants.map(p => Number(p.parentId))]);
  if (!parentIds.size) return { diagnostic: 'commerce-identity-unmatched' };
  if (parents.length > 1 || variants.some(v => !Number.isSafeInteger(Number(v.parentId)) || Number(v.parentId) <= 0)
      || parentIds.size !== 1 || [...parentIds].some(id => !Number.isSafeInteger(id) || id <= 0)) {
    return { diagnostic: 'commerce-identity-ambiguous' };
  }
  const id = [...parentIds][0];
  const parent = inventory.find(p => Number(p.id) === id);
  if (!parent || (parent.sku !== identity.parentSku && !variants.length)) return { diagnostic: 'commerce-parent-unavailable' };
  // A conflicting parent SKU is not a valid variant-based alias.
  if (parent.sku && parent.sku !== identity.parentSku) return { diagnostic: 'commerce-identity-ambiguous' };
  return { id, parent };
}

function uploadedPhotos(product, apiOrigin) {
  // Overlay slots retain actual back-office positions; Woo image order is only
  // used when no uploaded photo exists in that slot.
  const candidates = [...(product.uploadedPhotos || []),
    ...(product.images || []).map((p, index) => ({ ...p, slot: p.slot ?? index + 1 }))];
  const photos = new Map();
  for (const p of candidates) {
    const slot = Number(p.slot);
    const src = publicUrl(p.src, apiOrigin);
    if (!Number.isInteger(slot) || slot < 1 || slot > 6 || photos.has(slot) || !src?.startsWith('https:')
        || /(?:placeholder|favicon|(?:^|[/-])logo(?:[./-]|$))/i.test(new URL(src).pathname)) continue;
    photos.set(slot, { slot, src, alt: typeof p.alt === 'string' ? p.alt : '' });
  }
  return [...photos.values()].sort((a, b) => a.slot - b.slot);
}

async function recordOperation(record, identity, data, inventory = null) {
  const diagnostics = [];
  let match;
  try { match = resolveIdentity(identity, inventory || await data.products()); }
  catch (error) {
    if (!(error instanceof PublicDataError)) throw error;
    diagnostics.push('commerce-provider-unavailable');
    return { commerceId: null, availability: null, images: [], diagnostics: [...diagnostics, 'product-photo-missing'] };
  }
  if (!match.id) return { commerceId: null, availability: null, images: [],
    diagnostics: [match.diagnostic, 'product-photo-missing'] };
  let live = null;
  try {
    // Catalogue snapshots establish identity, never live stock. No detail read,
    // no availability claim. Strict provenance is checked by the adapter.
    if (data.productOperation) live = await data.productOperation(match.id);
    if (live && (Number(live.id) !== match.id || live.sku !== identity.parentSku)) {
      diagnostics.push('live-identity-mismatch');
      live = null;
    }
  } catch { diagnostics.push('live-stock-unavailable'); }
  const availability = live ? { instock: 'InStock', outofstock: 'OutOfStock', onbackorder: 'BackOrder' }[live.stockStatus] || null : null;
  if (!availability) diagnostics.push('live-stock-unknown');
  const operationalPrice = live?.salePrice || live?.price || live?.regularPrice;
  if (operationalPrice !== undefined && operationalPrice !== '' && record.price !== null && Number(operationalPrice) !== record.price) {
    diagnostics.push('commerce-price-differs-from-approved');
  }
  const images = uploadedPhotos(live || match.parent, data.mediaOrigin);
  if (!images.length) diagnostics.push('product-photo-missing');
  return { commerceId: match.id, availability, images, diagnostics };
}

module.exports = { resolveIdentity, uploadedPhotos, recordOperation };
