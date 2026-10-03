const pages = require('../data/public-pages.json');
const { PublicDataError } = require('./public-content.cjs');
const { articleInlineLinks } = require('@workspace/api-zod/blog-inline-links-core');

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const jsonScript = value => JSON.stringify(value).replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const text = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const date = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;

function createPublicRenderer({ canonicalOrigin, basePath = '', data }) {
  // No Host-header-derived canonicals; explicit owner-approved origin only.
  const origin = new URL(canonicalOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Canonical origin must be an explicit HTTPS origin');
  }
  const absolute = route => new URL(route, origin).href;
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
    try {
      let page = pages[route];
      let body = page ? paragraph(page.description) : '';
      let meta;
      let schemas = [];
      if (route === '/' || route === '/products') {
        const products = await data.products();
        body += `<h2>Products</h2><ul>${products.map(product => {
          if (!Number.isSafeInteger(Number(product.id)) || Number(product.id) <= 0 || !product.name) throw new PublicDataError();
          return `<li>${link(`/product/${product.id}`, product.name)}${paragraph(text(product.shortDescription))}</li>`;
        }).join('')}</ul>`;
      } else if (route === '/blog') {
        body += `<ul>${(await data.articles()).map(article => {
          if (!identifier(article.slug) || !article.title) throw new PublicDataError();
          return `<li>${link(`/blog/${article.slug}`, article.title)}${paragraph(article.summary)}</li>`;
        }).join('')}</ul>`;
      } else if (route === '/support') {
        body += `<ul>${(await data.guides()).map(guide => {
          if (!identifier(guide.slug) || !guide.title) throw new PublicDataError();
          return `<li>${link(`/guide/${guide.slug}`, guide.title)}${paragraph(guide.summary)}</li>`;
        }).join('')}</ul>`;
      } else if (route === '/map') {
        body += (await data.locations()).map(location =>
          `<section><h2>${escapeHtml(location.name)}</h2>${paragraph(location.address)}${paragraph(location.hours)}${paragraph(location.accessNotes)}</section>`).join('');
      } else if (/^\/product\/[1-9]\d*$/.test(route)) {
        // Catalogue membership is the publication boundary. The detail endpoint
        // can return legacy/mock/draft records, so it is not an indexing source.
        const product = (await data.products()).find(item => String(item.id) === route.split('/')[2]);
        if (!product) return errorPage(404);
        if (!product.name) throw new PublicDataError();
        page = { title: text(product.name), description: text(product.shortDescription || product.description) || text(product.name) };
        const photos = Array.isArray(product.images) ? product.images : [];
        body = paragraph(page.description) + photos.map(photo => image(photo.src, photo.alt || product.name)).join('')
          + `<h2>Product details</h2>${paragraph(text(product.description))}`;
        if (typeof product.price === 'string' && product.price !== '') {
          body += paragraph(`Price: ${product.price}`);
        }
        body += link(`/enquiry?productId=${encodeURIComponent(product.id)}`, 'Enquire about this product');
        meta = metadata(route, page.title, page.description, 'product',
          safeUrl(photos[0]?.src) || absolute('/favicon.png'));
        // Currency isn't in the public payload: never invent offers, ratings,
        // certifications or availability. Product schema supports no-offer data.
        schemas = [{
          '@context': 'https://schema.org', '@type': 'Product', name: page.title,
          description: text(product.description || page.description), url: meta.url,
          ...(product.sku ? { sku: String(product.sku) } : {}),
          ...(photos.some(photo => safeUrl(photo.src)) ? { image: photos.map(photo => safeUrl(photo.src)).filter(Boolean) } : {}),
        }];
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
        schemas = [{
          '@context': 'https://schema.org', '@type': 'BlogPosting', headline: article.title,
          description: text(article.summary), articleBody: article.body, url: meta.url,
          ...(date(article.publishedAt) ? { datePublished: date(article.publishedAt) } : {}),
        }];
      } else if (/^\/guide\/[^/]+$/.test(route)) {
        const slug = route.split('/')[2];
        if (!identifier(slug)) return errorPage(404);
        const guide = await data.guide(slug);
        if (guide.slug !== slug) return errorPage(404);
        page = { title: guide.title, description: guide.summary || guide.title };
        body = paragraph(guide.summary) + guide.sections.map(section =>
          `<section><h2>${escapeHtml(section.heading)}</h2>${paragraph(section.body)}`
          + (Array.isArray(section.steps) ? `<ol>${section.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : '')
          + paragraph(section.tip) + paragraph(section.warning)
          + (Array.isArray(section.media) ? section.media.filter(media => media.kind !== 'video')
            .map(media => image(media.url, media.altText)).join('') : '')
          + '</section>').join('');
        const steps = guide.sections.flatMap(section => Array.isArray(section.steps) ? section.steps : []).filter(step => String(step).trim());
        if (steps.length) schemas = [{
          '@context': 'https://schema.org', '@type': 'HowTo', name: guide.title,
          description: text(guide.summary), url: absolute(route),
          step: steps.map(step => ({ '@type': 'HowToStep', text: String(step) })),
        }];
      } else if (!page) return errorPage(404);

      meta ||= metadata(route, page.title, page.description);
      if (!schemas.length) schemas = [{
        '@context': 'https://schema.org', '@type': 'WebPage', name: page.title,
        description: meta.description, url: meta.url,
      }];
      if (route === '/') schemas.push({
        '@context': 'https://schema.org', '@type': 'WebSite', name: 'Ultra-Clear Companion', url: absolute('/'),
      });
      return { status: 200, meta, body: `<h1>${escapeHtml(page.title)}</h1>${body}${nav}`, schemas };
    } catch (error) {
      if (!(error instanceof PublicDataError)) console.error('Public rendering failed:', error.message);
      return errorPage(error instanceof PublicDataError ? error.status : 503);
    }
  }

  async function sitemap() {
    const [products, articles, guides] = await Promise.all([data.products(), data.articles(), data.guides()]);
    const routes = Object.keys(pages);
    for (const product of products) {
      if (!Number.isSafeInteger(Number(product.id)) || Number(product.id) <= 0) throw new PublicDataError();
      routes.push(`/product/${product.id}`);
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