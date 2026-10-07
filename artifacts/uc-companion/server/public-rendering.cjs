const pages = require('../data/public-pages.json');
const { PublicDataError } = require('./public-content.cjs');
const { articleInlineLinks } = require('@workspace/api-zod/blog-inline-links-core');
const { identity, breadcrumbs, recordProductModel, articleModel, guideModel, itemList } = require('./public-schema.cjs');
const { resolveIdentity, recordOperation } = require('./record-operations.cjs');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const jsonScript = value => JSON.stringify(value).replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const text = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);

function createPublicRenderer({ canonicalOrigin, basePath = '', data, records = require('./product-records.cjs').records }) {
  // No Host-header-derived canonicals; explicit owner-approved origin only.
  const origin = new URL(canonicalOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Canonical origin must be an explicit HTTPS origin');
  }
  const absolute = route => {
    const url = new URL(route, origin);
    url.search = '';
    return url.href;
  };
  const local = route => `${basePath}${route}`;
  const link = (route, label) => `<a href="${escapeHtml(local(route))}">${escapeHtml(label)}</a>`;
  const nav = `<nav aria-label="Public pages">${Object.entries(pages)
    .map(([route, page]) => link(route, page.title)).join(' · ')}</nav>`;
  const paragraph = value => `<p>${escapeHtml(value)}</p>`;
  const safeUrl = value => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, origin);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const image = (src, alt) => {
    const url = safeUrl(src);
    return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="400" style="max-width:100%;height:auto">` : '';
  };

  function metadata(route, title, description, type = 'website', imageUrl = absolute('/favicon.png')) {
    const url = absolute(route);
    return {
      title: route === '/' ? title : `${title} | Ultra-Clear Companion`,
      description: text(description).slice(0, 240) || title,
      canonical: url, robots: 'index, follow', type, image: imageUrl, url,
    };
  }
  function errorPage(status) {
    const title = status === 404 ? 'Page not found' : 'Content temporarily unavailable';
    return {
      status,
      meta: { title, description: title, robots: 'noindex, follow' },
      body: `<h1>${title}</h1>${paragraph(status === 404
        ? 'This public page is unavailable. Explore the catalogue or support guides.'
        : 'Please try again shortly. No unavailable content has been substituted.')}${nav}`,
      schemas: [],
    };
  }

  async function render(route) {
    let effectiveRecords = records;
    if (data.editorialRecords) {
      try { effectiveRecords = await data.editorialRecords(); }
      catch { return errorPage(503); }
    }
    const activeRecords = effectiveRecords;
    try {
      route = new URL(route, origin).pathname.replace(/\/$/, '') || '/';
      let page = pages[route];
      let body = page ? paragraph(page.description) : '';
      let meta;
      let schemas = [];
      let publicRecord = null;
      let documentKind = null;
      let canonicalRoute = route;
      const crumbs = [{ name: 'Home', path: '/' }];
      if (route === '/' || route === '/products') {
        const products = activeRecords.products;
        const entries = [];
        body += `<h2>Products</h2><ul>${products.map(product => {
          entries.push({ name: product.seo.h1, path: `/product/${product.slug}` });
          return `<li>${link(`/product/${product.slug}`, product.seo.h1)}${paragraph(product.opening.intro)}</li>`;
        }).join('')}</ul>`;
        schemas.push(itemList(entries, origin.href));
      } else if (route === '/blog') {
        const entries = [];
        body += `<ul>${(await data.articles()).map(article => {
          if (!identifier(article.slug) || !article.title) throw new PublicDataError();
          entries.push({ name: article.title, path: `/blog/${article.slug}` });
          return `<li>${link(`/blog/${article.slug}`, article.title)}${paragraph(article.summary)}</li>`;
        }).join('')}</ul>`;
        schemas.push(itemList(entries, origin.href));
      } else if (route === '/support') {
        const entries = [];
        body += `<ul>${(await data.guides()).map(guide => {
          if (!identifier(guide.slug) || !guide.title) throw new PublicDataError();
          entries.push({ name: guide.title, path: `/guide/${guide.slug}` });
          return `<li>${link(`/guide/${guide.slug}`, guide.title)}${paragraph(guide.summary)}</li>`;
        }).join('')}</ul>`;
        schemas.push(itemList(entries, origin.href));
      } else if (route === '/map') {
        body += (await data.locations()).map(location =>
          `<section><h2>${escapeHtml(location.name)}</h2>${paragraph(location.address)}${paragraph(location.hours)}${paragraph(location.accessNotes)}</section>`).join('');
      } else if (/^\/product\/[^/]+$/.test(route)) {
        const key = route.split('/')[2];
        let product = activeRecords.products.find(p => p.slug === key);
        let inventory = null;
        if (/^[1-9]\d*$/.test(key)) {
          inventory = await data.products();
          const matches = activeRecords.identities.filter(i => resolveIdentity(i, inventory).id === Number(key));
          if (matches.length !== 1) return errorPage(404);
          product = activeRecords.products.find(p => p.code === matches[0].code);
        }
        if (!product) return errorPage(404);
        canonicalRoute = `/product/${product.slug}`;
        documentKind = 'product';
        const operation = data.editorialProduct ? await data.editorialProduct(product.slug)
          : await recordOperation(product, activeRecords.identities.find(i => i.code === product.code), data, inventory);
        publicRecord = { ...product, ...operation };
        // The fetched effective record and its operation form one response:
        // metadata, body, schema and hydrated payload cannot mix revisions.
        product = publicRecord;
        const model = recordProductModel(product, operation, canonicalRoute, origin.href);
        page = { title: product.seo.h1, description: product.seo.description };
        const slots = ['Product', 'In use', 'Parts', 'Included', 'Colours', 'Size'];
        body = (product.seo.subline ? `<p class="uc-subline">${escapeHtml(product.seo.subline)}</p>` : '')
          + `<p class="uc-price">${product.price !== null ? `KES ${product.price.toLocaleString('en-KE')}` : 'Pricing on request'}</p>`
          + paragraph(product.opening.outcome) + paragraph(product.opening.intro) + paragraph(product.opening.suits)
          + `<p class="uc-warning">${escapeHtml(product.opening.warning)}</p>`
          + paragraph(product.opening.delivery)
          + paragraph(operation.availability ? { InStock: 'In stock', OutOfStock: 'Out of stock', BackOrder: 'Available on back-order' }[operation.availability] : 'Live stock unavailable — please enquire before ordering.')
          + `<div class="uc-gallery">${operation.images.map(photo => `<figure data-slot="${photo.slot}">${image(photo.src, photo.alt)}<figcaption>${escapeHtml(slots[photo.slot - 1])}</figcaption></figure>`).join('')}</div>`
          + (!operation.images.length ? paragraph('Product photo unavailable.') : '')
          + paragraph(`SKU: ${product.parentSku}`)
          + (product.claims.length ? `<section><h2>Product evidence</h2>${product.claims.map(c => paragraph(c.text)
            + paragraph(c.conditions) + c.reports.map(e => paragraph(`Tested by ${e.lab} (${e.report})`)).join('')).join('')}</section>` : '')
          + (product.faq.length ? `<section><h2>Frequently asked questions</h2>${product.faq.map(f => `<details><summary>${escapeHtml(f.q)}</summary>${paragraph(f.a)}</details>`).join('')}</section>` : '')
          + `<section><h2>Related topics</h2><ul>${product.topics.map(t => `<li>${link(`/topic/${t.slug}`, t.name)}</li>`).join('')}</ul></section>`
          + link(operation.commerceId ? `/enquiry?productId=${operation.commerceId}` : '/enquiry', 'Enquire about this product')
          + ' · ' + link('/cart', 'Cart');
        const list = values => Array.isArray(values) && values.length ? `<ul>${values.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>` : '';
        const accordion = (heading, content) => content ? `<details><summary>${escapeHtml(heading)}</summary>${content}</details>` : '';
        const pkg = product.package || {}, service = product.service || {}, suitability = product.suitability || {};
        body = `<section class="uc-choose" aria-label="Choose">${body}</section>`
          + `<section class="uc-understand" aria-label="Understand"><h2>${escapeHtml(product.benefits?.heading || 'Made for your routine')}</h2>`
          + (product.benefits?.items || []).map(b => `<article class="uc-product-card"><h3>${escapeHtml(b.feature)}</h3>${paragraph(b.consequence)}</article>`).join('')
          + accordion('Specifications', `<dl>${Object.entries(product.specs || {}).map(([k,v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`)
          + accordion(suitability.heading || 'Will it suit your water?', paragraph(suitability.intended_use) + list(suitability.water) + list(suitability.setup) + list(suitability.exclusions) + link('/water-test', 'Check my setup'))
          + list(product.evidenceLimits)
          + accordion(pkg.heading || 'What is included', list(pkg.included) + list(pkg.sold_separately) + paragraph(pkg.dimensions) + list(pkg.setup_steps) + link('/support', 'View setup guides'))
          + '</section><section class="uc-decide" aria-label="Decide"><h2>Know before you buy</h2>'
          + accordion('Replacement and care', paragraph(product.specs?.Care) + paragraph(product.ownership?.replacement?.name)
            + (product.ownership?.replacement?.price_kes != null ? paragraph(`Replacement: KES ${product.ownership.replacement.price_kes.toLocaleString('en-KE')}`) : '')
            + paragraph(product.ownership?.replacement?.guidance))
          + accordion('Delivery, service and returns', paragraph('Choose our delivery or self-paid delivery at checkout.')
            + paragraph(service.support) + paragraph(service.warranty?.text) + paragraph(service.returns) + list(service.exclusions))
          + `<article class="uc-product-card"><h2>${escapeHtml(product.summary?.heading || 'Review your selection')}</h2>`
          + paragraph(product.name) + paragraph(product.seo.subline)
          + paragraph(product.price !== null ? `KES ${product.price.toLocaleString('en-KE')}` : 'Pricing on request')
          + link('/cart', 'Open cart') + '</article></section>';
        meta = { ...metadata(canonicalRoute, page.title, page.description, 'product', safeUrl(operation.images[0]?.src)),
          title: product.seo.title, description: product.seo.description };
        schemas = [model.schema, ...(model.faq ? [model.faq] : [])];
        crumbs.push({ name: 'Products', path: '/products' });
      } else if (/^\/topic\/[^/]+$/.test(route)) {
        const topic = activeRecords.topics.find(t => t.slug === route.split('/')[2]);
        if (!topic) return errorPage(404);
        documentKind = 'topic';
        page = { title: topic.name, description: '' };
        body = `<section aria-label="Topic article"></section><nav aria-label="Related products"><h2>Related products</h2><ul>${topic.products.map(p =>
          `<li>${link(`/product/${p.slug}`, p.name)}</li>`).join('')}</ul></nav>`;
        meta = { ...metadata(route, page.title, '', 'website', null), robots: 'noindex, follow' };
      } else if (/^\/blog\/[^/]+$/.test(route)) {
        const slug = route.split('/')[2];
        if (!identifier(slug)) return errorPage(404);
        const article = await data.article(slug);
        if (article.slug !== slug) return errorPage(404);
        page = { title: article.title, description: article.summary || text(article.body).slice(0, 240) };
        const inline = value => articleInlineLinks(value, article.sources || []).map(part =>
          part.kind === 'link' ? `<a href="${escapeHtml(part.url)}">${escapeHtml(part.text)}</a>` : escapeHtml(part.text)).join('');
        body = paragraph(article.summary) + String(article.body).split(/\n\s*\n/).map(block => {
          const heading = block.match(/^#{1,3}\s+([^\n]+)$/);
          return heading ? `<h2>${inline(heading[1])}</h2>` : `<p>${inline(block)}</p>`;
        }).join('');
        if (Array.isArray(article.sources)) {
          body += '<h2>Sources</h2><ul>' + article.sources.map(source => {
            const url = safeUrl(source.url);
            return url ? `<li><a href="${escapeHtml(url)}">${escapeHtml(source.title || source.label || 'Article source')}</a></li>` : '';
          }).join('') + '</ul>';
        }
        meta = metadata(route, page.title, page.description, 'article');
        const model = articleModel(article, route, origin.href);
        if (model.publishedAt) body = `<time datetime="${escapeHtml(model.publishedAt)}">${escapeHtml(model.publishedAt)}</time>` + body;
        schemas = [model.schema];
        crumbs.push({ name: 'Blog', path: '/blog' });
      } else if (/^\/guide\/[^/]+$/.test(route)) {
        const slug = route.split('/')[2];
        if (!identifier(slug)) return errorPage(404);
        const guide = await data.guide(slug);
        if (guide.slug !== slug) return errorPage(404);
        const model = guideModel(guide, route, data.mediaOrigin || origin.href, origin.href);
        page = { title: guide.title, description: guide.summary || guide.title };
        body = paragraph(guide.summary) + model.sections.map(section =>
          `<section><h2>${escapeHtml(section.heading)}</h2>${paragraph(section.body)}`
          + (Array.isArray(section.steps) ? `<ol>${section.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : '')
          + paragraph(section.tip) + paragraph(section.warning)
          + section.media.map(media => `<figure>${media.kind === 'video'
            ? `<video controls preload="none" src="${escapeHtml(media.url)}"${media.posterUrl ? ` poster="${escapeHtml(media.posterUrl)}"` : ''} aria-label="${escapeHtml(media.altText)}"></video>`
            : image(media.url, media.altText)}${media.caption ? `<figcaption>${escapeHtml(media.caption)}</figcaption>` : ''}</figure>`).join('')
          + '</section>').join('');
        if (model.schema) schemas = [model.schema];
        crumbs.push({ name: 'Support', path: '/support' });
      } else if (!page) return errorPage(404);

      meta ||= metadata(route, page.title, page.description);
      if (!schemas.length) schemas = [{
        '@context': 'https://schema.org', '@type': 'WebPage', name: page.title,
        description: meta.description, url: meta.url,
      }];
      if (route !== '/') {
        crumbs.push({ name: page.title, path: canonicalRoute });
        schemas.push(breadcrumbs(crumbs, origin.href));
        body = `<nav aria-label="Breadcrumb">${crumbs.map(crumb => link(crumb.path, crumb.name)).join(' / ')}</nav>` + body;
      }
      // One graph binds the site's verified identity to every eligible template.
      schemas = [{ '@context': 'https://schema.org', '@graph': [...identity(origin.href), ...schemas.map(schema => {
        const { '@context': _context, ...node } = schema;
        return node;
      })] }];
      return { status: 200, meta, body: `<header><a href="https://ucfilters.com/">Ultra Clear</a></header><h1>${escapeHtml(page.title)}</h1>${body}${nav}`, schemas,
        documentKind, publicRecord };
    } catch (error) {
      if (!(error instanceof PublicDataError)) console.error('Public rendering failed:', error.message);
      return errorPage(error instanceof PublicDataError ? error.status : 503);
    }
  }

  async function sitemap() {
    const activeRecords = data.editorialRecords ? await data.editorialRecords() : records;
    const [articles, guides] = await Promise.all([data.articles(), data.guides()]);
    const routes = Object.keys(pages);
    for (const product of activeRecords.products) {
      routes.push(`/product/${product.slug}`);
    }
    for (const article of articles) {
      if (!identifier(article.slug)) throw new PublicDataError();
      routes.push(`/blog/${article.slug}`);
    }
    for (const guide of guides) {
      if (!identifier(guide.slug)) throw new PublicDataError();
      routes.push(`/guide/${guide.slug}`);
    }
    // No generated lastmod: public payloads lack reliable modification dates.
    const urls = [...new Set(routes)];
    if (urls.length > 50000) throw new PublicDataError();
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
      .map(route => `<url><loc>${escapeHtml(absolute(route))}</loc></url>`).join('')}</urlset>`;
  }
  return {
    render, sitemap,
    robots: () => `User-agent: *\nAllow: /\nSitemap: ${absolute('/sitemap.xml')}\n`,
  };
}

function renderHead(meta, schemas = []) {
  const tag = (name, value, property = false) => value
    ? `<meta data-uc-seo ${property ? 'property' : 'name'}="${name}" content="${escapeHtml(value)}">` : '';
  return `<title>${escapeHtml(meta.title)}</title>`
    + tag('description', meta.description) + tag('robots', meta.robots)
    + (meta.canonical ? `<link data-uc-seo rel="canonical" href="${escapeHtml(meta.canonical)}">` : '')
    + tag('og:title', meta.title, true) + tag('og:description', meta.description, true)
    + tag('og:url', meta.url, true) + tag('og:type', meta.type, true)
    + tag('og:site_name', 'Ultra-Clear Companion', true) + tag('og:image', meta.image, true)
    + tag('twitter:card', meta.image ? 'summary_large_image' : 'summary')
    + tag('twitter:title', meta.title) + tag('twitter:description', meta.description)
    + tag('twitter:image', meta.image)
    + schemas.map(schema => `<script data-uc-seo type="application/ld+json">${jsonScript(schema)}</script>`).join('');
}

module.exports = { createPublicRenderer, renderHead, escapeHtml, jsonScript };