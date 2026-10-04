/**
 * Public-only data adapter. Never forwards visitor headers, cookies or tokens.
 * Deliberately has no persistent cache: unpublishing takes effect immediately.
 */
class PublicDataError extends Error {
  constructor(status = 503) {
    super(status === 404 ? 'Public content not found' : 'Public content temporarily unavailable');
    this.status = status;
  }
}

function createPublicData(apiOrigin, fetchImpl = fetch) {
  const origin = new URL(apiOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Public API origin must be an HTTP(S) origin without credentials or a path');
  }
  async function read(route, requiredProvenance = null) {
    try {
      const response = await fetchImpl(new URL(`/api/uc/${route}`, origin), {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new PublicDataError(response.status === 404 ? 404 : 503);
      if (requiredProvenance && response.headers.get('x-uc-catalogue-provenance') !== requiredProvenance) {
        throw new PublicDataError();
      }
      return await response.json();
    } catch (error) {
      throw error instanceof PublicDataError ? error : new PublicDataError();
    }
  }
  function array(value) {
    if (!Array.isArray(value)) throw new PublicDataError();
    return value;
  }
  return {
    mediaOrigin: origin.origin,
    products: async () => array(await read('products?publicationSafe=true', 'woocommerce-published')),
    guides: async () => array((await read('guides')).guides),
    guide: async slug => {
      const value = (await read(`guides/${encodeURIComponent(slug)}`)).guide;
      if (!value?.title || !Array.isArray(value.sections)) throw new PublicDataError();
      return value;
    },
    article: async slug => {
      const value = (await read(`blog/${encodeURIComponent(slug)}`)).article;
      if (!value?.title || typeof value.body !== 'string') throw new PublicDataError();
      return value;
    },
    articles: async () => {
      const articles = [];
      const seen = new Set();
      let cursor = null;
      // Reject a partial inventory rather than publish a silently truncated sitemap.
      for (let page = 0; page < 100; page++) {
        const result = await read(`blog?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        articles.push(...array(result.articles));
        if (result.nextCursor === null) return articles;
        if (typeof result.nextCursor !== 'string' || !result.nextCursor || seen.has(result.nextCursor)) {
          throw new PublicDataError();
        }
        cursor = result.nextCursor;
        seen.add(cursor);
      }
      throw new PublicDataError();
    },
    locations: async () => array(await read('locations')),
  };
}

module.exports = { createPublicData, PublicDataError };