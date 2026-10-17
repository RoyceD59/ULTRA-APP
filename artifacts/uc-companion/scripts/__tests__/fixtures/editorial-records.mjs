import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const { records } = require('../../../server/product-records.cjs');
const { recordOperation } = require('../../../server/record-operations.cjs');

// Model the current two-endpoint public editorial API, not the retired
// WooCommerce-only fixture. Use the real operational projection, not a copy.
export async function editorialProduct(key, inventory, mediaOrigin = 'https://api.example.test') {
  const record = records.products.find(product => product.slug === key);
  if (!record) return null;
  const operation = await recordOperation(record, records.identities.find(identity => identity.code === record.code), {
    mediaOrigin,
    products: async () => inventory,
    productOperation: async id => inventory.find(product => product.id === id),
  });
  return { ...record, ...operation };
}
