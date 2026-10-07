// Server-only authored source. Never import the source JSON into a client bundle.
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = require('./records/products_v2.4.json');
const retail = require('./records/retail-prices_v6.json');
const validate = require('./records/validate-products.cjs');
const schemaHash = crypto.createHash('sha256').update(fs.readFileSync(require.resolve('./records/product_content_v2.4.schema.json'))).digest('hex');
if (validate.schemaHash !== schemaHash) throw new Error('Product validator is stale');
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const allowedClaims = new Set(['verified', 'manufacturer', 'customer_reported']);

function createRecordCollection(input = source) {
  // Keep the uploaded v2.4 file verbatim, but apply the owner's superseding
  // Excel prices to default/offline authored rendering. Explicit DB input
  // is already authoritative and must retain subsequent staff edits.
  if (input === source) input = { ...source, products: source.products.map(p => {
    const price = retail.prices[p.parent_sku];
    return price === undefined ? p : { ...p, price_kes: price,
      ownership: { ...p.ownership, product_price_kes: price } };
  }) };
  if (!validate(input) || input.schema_version !== '2.4') {
    throw new Error(`Invalid v2.4 product records: ${JSON.stringify(validate.errors)}`);
  }
  const unique = (values, label) => {
    if (values.some(value => typeof value !== 'string' || !value.trim()) || new Set(values).size !== values.length) {
      throw new Error(`Invalid or duplicate ${label}`);
    }
  };
  unique(input.products.map(p => p.code), 'product codes');
  unique(input.products.map(p => p.slug), 'product slugs');
  unique(input.products.flatMap(p => [p.parent_sku, ...p.variants.map(v => v.child_sku)]), 'product SKUs');
  const held = new Set((input.held_back || []).map(p => p.sku));
  for (const p of input.products) {
    if (!slugPattern.test(p.slug) || (p.price_kes !== null && (!Number.isFinite(p.price_kes) || p.price_kes < 0))
        || p.variants.some(v => typeof v.label !== 'string')
        || p.faq.some(f => typeof f.q !== 'string' || typeof f.a !== 'string')
        || new Set(p.images.map(i => i.slot)).size !== p.images.length
        || (p.publishable && [p.parent_sku, ...p.variants.map(v => v.child_sku)].some(sku => held.has(sku)))) {
      throw new Error(`Invalid product identity or fields: ${p.code}`);
    }
  }
  const eligible = input.products.filter(p => p.publishable && !held.has(p.parent_sku));
  const byCode = new Map(eligible.map(p => [p.code, p]));
  const topics = input.topic_pages || [];
  unique(topics.map(t => t.topic), 'topic names');
  unique(topics.map(t => t.slug), 'topic slugs');
  for (const t of topics) {
    if (!slugPattern.test(t.slug) || !Array.isArray(t.products) || new Set(t.products).size !== t.products.length
        || t.products.some(code => !byCode.has(code))) throw new Error('Invalid topic membership');
  }
  for (const p of eligible) {
    unique(p.seo.topics || [], 'product topics');
    for (const name of p.seo.topics || []) {
      if (!topics.some(t => t.topic === name && t.products.includes(p.code))) throw new Error('Unresolved product topic');
    }
  }
  for (const t of topics) {
    if (t.products.some(code => !(byCode.get(code).seo.topics || []).includes(t.topic))) {
      throw new Error('Non-reciprocal topic membership');
    }
  }
  // Explicit allowlist: no internal, held_back, evidence clients, snapshot stock,
  // placeholder file paths, editorial notes, or confirm claims cross this boundary.
  const products = eligible.map(p => ({
    code: p.code, slug: p.slug, name: p.name, parentSku: p.parent_sku,
    category: p.category,
    variants: p.variants.map(v => ({ childSku: v.child_sku, label: v.label })),
    specs: { ...p.specs },
    suitability: projectSection(p.suitability, ['heading', 'intended_use', 'water', 'setup', 'exclusions', 'action']),
    benefits: { heading: p.benefits.heading || '', items: (p.benefits.items || []).map(b => ({ feature: b.feature, consequence: b.consequence })) },
    package: projectSection(p.package, ['heading', 'included', 'sold_separately', 'dimensions', 'setup_steps', 'setup_video', 'action']),
    ownership: { ...projectSection(p.ownership, ['heading', 'installation', 'action']),
      replacement: p.ownership.replacement ? projectSection(p.ownership.replacement, ['name', 'sku', 'price_kes', 'guidance']) : null },
    service: { ...projectSection(p.service, ['heading', 'support', 'returns', 'exclusions']),
      delivery: 'Choose our delivery or self-paid delivery at checkout.',
      warranty: p.service.warranty ? projectSection(p.service.warranty, ['days', 'text']) : null },
    summary: projectSection(p.summary || {}, ['heading']),
    imageMappings: p.images.filter(i => i.approved && i.alt && !i.file.startsWith('images/')).map(i => ({
      slot: i.slot, src: i.file, alt: i.alt, picturedColour: i.pictured_colour || null, childSku: i.child_sku || null,
    })),
    purchasable: p.purchasable && p.price_kes !== null && p.availability !== 'By enquiry',
    price: p.price_kes, currency: 'KES',
    seo: { title: p.seo.title, h1: p.seo.h1, subline: p.seo.h1_sub || '',
      description: p.seo.description, status: p.seo.status },
    opening: { outcome: p.opening.outcome, intro: p.opening.intro, suits: p.opening.suits,
      warning: p.opening.critical_limit, delivery: 'Choose our delivery or self-paid delivery at checkout.' },
    faq: p.faq.map(f => ({ q: f.q, a: f.a })),
    claims: (p.evidence.claims || []).filter(c => allowedClaims.has(c.status)).map(c => ({
      text: c.text, status: c.status, conditions: c.conditions || '',
      reports: c.evidence.map(key => input.evidence[key]).filter(Boolean)
        .map(e => ({ lab: e.lab, report: e.report_no })),
    })),
    evidenceLimits: (p.evidence.limits || []).slice(),
    topics: topics.filter(t => (p.seo.topics || []).includes(t.topic))
      .map(t => ({ name: t.topic, slug: t.slug })),
  }));
  return {
    products,
    topics: topics.map(t => ({ name: t.topic, slug: t.slug,
      products: t.products.map(code => {
        const p = products.find(p => p.code === code);
        return { code: p.code, name: p.seo.h1, slug: p.slug };
      }) })),
    // Private identity lookup; not serialized.
    identities: eligible.map(p => ({ code: p.code, parentSku: p.parent_sku,
      variants: p.variants.map(v => v.child_sku) })),
  };
}

const records = createRecordCollection();
function projectSection(value, keys) {
  return Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
}
module.exports = { records, createRecordCollection, source };
