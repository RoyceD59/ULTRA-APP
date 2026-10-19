/** Match server width buckets so equivalent devices share the same CDN key. */
export function optimizedProductImageUrl(source: string, pixels: number): string {
  try {
    const url = new URL(source);
    const catalogue = url.pathname.startsWith('/api/uc/product-images/');
    const upload = url.pathname.startsWith('/api/storage/objects/uploads/');
    if (!catalogue && !upload) return source;
    const wanted = Number.isFinite(pixels) ? Math.max(1, pixels) : 384;
    const width = [128, 256, 384, 512, 768].find(value => value >= wanted) ?? 768;
    url.searchParams.set('w', String(width));
    if (catalogue) url.searchParams.set('fmt', 'webp');
    return url.href;
  } catch { return source; }
}
