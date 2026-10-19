/** Read-only latency/media sampling. Usage: node script.cjs ORIGIN output.json */
const fs = require('node:fs');
async function timed(url) {
  const start = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ms: performance.now() - start, bytes: bytes.length,
    encoding: res.headers.get('content-encoding'), cache: res.headers.get('x-uc-catalogue-cache'),
    serverTiming: res.headers.get('server-timing'), type: res.headers.get('content-type'),
    redirected: res.redirected, body: bytes };
}
async function main() {
  const origin = new URL(process.argv[2]).origin;
  const reads = [];
  let products;
  for (let run = 0; run < 10; run++) {
    const { body, ...sample } = await timed(`${origin}/api/uc/products`);
    if (sample.status !== 200) throw new Error(`Catalogue HTTP ${sample.status}`);
    products = JSON.parse(body);
    reads.push({ run, ...sample });
  }
  const images = [];
  // Serial to avoid a synthetic resize stampede; no writes/customer requests.
  for (const p of (process.argv[4] === '--no-media' ? [] : products)) {
    const src = p.images?.[0]?.src;
    if (!src) continue;
    const base = new URL(src, origin);
    for (const width of [384, 768]) {
      const url = new URL(base);
      if (url.pathname.includes('/api/uc/product-images/') || url.pathname.includes('/api/storage/objects/uploads/')) {
        url.searchParams.set('w', width);
        url.searchParams.set('fmt', 'webp');
      }
      const { body, ...sample } = await timed(url);
      images.push({ productId: p.id, width, ...sample });
    }
  }
  fs.writeFileSync(process.argv[3], JSON.stringify({
    origin, measuredAt: new Date().toISOString(),
    note: 'Catalogue reads use fresh sequential requests, not forced origin cache eviction. Fetch decodes compression; bytes are decoded. Image sample covers first image per product, not every gallery image.',
    productCount: products.length, reads, images,
  }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });