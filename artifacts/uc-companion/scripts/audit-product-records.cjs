// Read-only rollout evidence. No visitor credentials, provider writes or flag changes.
const fs = require('node:fs');
const { records } = require('../server/product-records.cjs');
const { recordOperation } = require('../server/record-operations.cjs');
const { createPublicData } = require('../server/public-content.cjs');

async function audit(apiOrigin) {
  const data = createPublicData(apiOrigin);
  let inventory;
  try { inventory = await data.products(); }
  catch { inventory = []; }
  const result = [];
  // Bounded operational reads: avoid 21 concurrent provider calls.
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < records.products.length) {
      const index = cursor++;
      const record = records.products[index];
      const operation = await recordOperation(record, records.identities.find(i => i.code === record.code), data, inventory);
      result[index] = { code: record.code, slug: record.slug, parentSku: record.parentSku,
        recordPrice: record.price, seoStatus: record.seo.status,
        commerceId: operation.commerceId, availability: operation.availability,
        observedCataloguePrice: inventory.find(p => p.id === operation.commerceId)?.price ?? null,
        photoSlots: operation.images.map(p => p.slot), diagnostics: operation.diagnostics };
    }
  }));
  return { scope: 'Read-only development operational evidence; not publication, Rich Results or WhatsApp validation.',
    catalogueVerified: inventory.length > 0, products: result };
}
if (require.main === module) {
  const [apiOrigin, output] = process.argv.slice(2);
  if (!apiOrigin) throw new Error('Usage: node scripts/audit-product-records.cjs <api-origin> [output.json]');
  audit(apiOrigin).then(result => {
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (output) fs.writeFileSync(output, json); else process.stdout.write(json);
  }).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
module.exports = { audit };
