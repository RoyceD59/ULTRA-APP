// Public payloads only. Never pass session, customer, editor, or review data here.
const { APP_HOST } = require('./browser-entry.cjs');
const SITE = `https://${APP_HOST}`;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function plain(value) {
  return text(value).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
}

function publicUrl(value, origin = SITE) {
  if (!text(value)) return undefined;
  try {
    const url = new URL(value, origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

function canonical(route, site = SITE) {
  const url = new URL(route, site);
  url.search = '';
  return url.href;
}

function identity(site = SITE) {
  const organizationId = canonical('/#organization', site);
  const websiteId = canonical('/#website', site);
  return [
    { '@type': 'Organization', '@id': organizationId, name: 'Ultra Clear', url: 'https://ucfilters.com/' },
    { '@type': 'WebSite', '@id': websiteId, name: 'Ultra-Clear Companion', url: canonical('/', site),
      publisher: { '@id': organizationId } },
  ];
}

function breadcrumbs(links, site = SITE) {
  return { '@type': 'BreadcrumbList', itemListElement: links.map((link, index) => ({
    '@type': 'ListItem', position: index + 1, name: link.name, item: canonical(link.path, site),
  })) };
}

function productModel(product, route, apiOrigin, site = SITE) {
  if (!text(product?.name)) throw new Error('Invalid public product');
  const images = (Array.isArray(product.images) ? product.images : [])
    .map(image => ({ src: publicUrl(image.src, apiOrigin), alt: text(image.alt) }))
    .filter(image => image.src?.startsWith('https://'));
  // Same sale/regular-price precedence and fixed KES presentation as the app.
  const price = text(product.salePrice || product.price || product.regularPrice);
  const sale = product.enquiryOnly !== true && /^\d+(?:\.\d+)?$/.test(price) && Number.isFinite(Number(price));
  const availability = { instock: 'InStock', outofstock: 'OutOfStock' }[product.stockStatus];
  const schema = { '@type': 'Product', '@id': `${canonical(route, site)}#product`,
    name: text(product.name), url: canonical(route, site) };
  const description = plain(product.description || product.shortDescription);
  if (description) schema.description = description;
  if (text(product.sku)) schema.sku = text(product.sku);
  if (images.length) schema.image = images.map(image => image.src);
  if (sale) {
    schema.offers = { '@type': 'Offer', url: canonical(route, site), price, priceCurrency: 'KES' };
    if (availability) schema.offers.availability = `https://schema.org/${availability}`;
  }
  return { schema, title: schema.name, description, images, sku: schema.sku,
    price: sale ? price : null, enquiryOnly: product.enquiryOnly === true, availability };
}

function articleModel(article, route, site = SITE) {
  if (!text(article?.title) || !text(article?.body)) throw new Error('Invalid public article');
  const schema = { '@type': 'BlogPosting', '@id': `${canonical(route, site)}#article`,
    url: canonical(route, site), headline: text(article.title), articleBody: text(article.body),
    publisher: { '@id': canonical('/#organization', site) }, mainEntityOfPage: canonical(route, site) };
  if (text(article.summary)) schema.description = text(article.summary);
  // No updatedAt: editorial DB edits do not necessarily change the published snapshot.
  if (text(article.publishedAt) && Number.isFinite(Date.parse(article.publishedAt))) {
    schema.datePublished = article.publishedAt;
  }
  return { schema, title: schema.headline, description: schema.description || '', body: schema.articleBody,
    publishedAt: schema.datePublished, sources: Array.isArray(article.sources) ? article.sources : [] };
}

function recordProductModel(record, operation, route, site = SITE) {
  const schema = { '@type': 'Product', '@id': `${canonical(route, site)}#product`,
    name: record.seo.h1, sku: record.parentSku, url: canonical(route, site),
    description: record.seo.description };
  if (operation.images.length) schema.image = operation.images.map(p => p.src);
  if (record.purchasable && record.price !== null) {
    schema.offers = { '@type': 'Offer', url: canonical(route, site),
      price: String(record.price), priceCurrency: 'KES' };
    if (operation.availability && !operation.diagnostics?.includes('record-commerce-price-disagreement')) schema.offers.availability = `https://schema.org/${operation.availability}`;
  }
  const faq = record.faq.length ? { '@type': 'FAQPage', '@id': `${canonical(route, site)}#faq`,
    mainEntity: record.faq.map(f => ({ '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a } })) } : null;
  return { schema, faq };
}

function guideModel(guide, route, apiOrigin, site = SITE) {
  if (!text(guide?.title) || !Array.isArray(guide.sections)) throw new Error('Invalid public guide');
  const sections = guide.sections.map(section => ({
    heading: text(section.heading), body: text(section.body), tip: text(section.tip), warning: text(section.warning),
    steps: (Array.isArray(section.steps) ? section.steps : []).map(text).filter(Boolean),
    media: (Array.isArray(section.media) ? section.media : []).map(media => ({
      kind: media.kind, url: publicUrl(media.url, apiOrigin), altText: text(media.altText),
      caption: text(media.caption), posterUrl: publicUrl(media.posterUrl, apiOrigin),
    })).filter(media => media.url?.startsWith('https://') && ['image', 'animation', 'video'].includes(media.kind)),
  }));
  const instructions = sections.filter(section => section.steps.length).map(section => {
    const part = { '@type': 'HowToSection', name: section.heading || text(guide.title),
      itemListElement: section.steps.map(step => ({ '@type': 'HowToStep', text: step })) };
    // Section-level images are not attributed to individual steps without evidence.
    const images = section.media.filter(media => media.kind !== 'video').map(media => media.url);
    if (images.length) part.image = images;
    return part;
  });
  const schema = instructions.length ? { '@type': 'HowTo', '@id': `${canonical(route, site)}#howto`,
    name: text(guide.title), description: text(guide.summary), url: canonical(route, site), step: instructions } : null;
  return { schema, title: text(guide.title), description: text(guide.summary), sections };
}

function itemList(entries, site = SITE) {
  return { '@type': 'ItemList', itemListElement: entries.map((entry, index) => ({
    '@type': 'ListItem', position: index + 1, name: entry.name, url: canonical(entry.path, site),
  })) };
}

function jsonLd(nodes) {
  // Safe inside an HTML script, including adversarial closing tags and JS separators.
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script id="uc-public-schema" type="application/ld+json">${json}</script>`;
}

module.exports = { SITE, text, plain, publicUrl, canonical, identity, breadcrumbs,
  productModel, recordProductModel, articleModel, guideModel, itemList, jsonLd };