'use strict';
// Disposable browser fixture only. Never a runtime/demo catalogue fallback.
const http = require('node:http');
const parent = { id: 10001, sku: 'UC-BOG-TRB-009', slug: 'truva-go', name: 'Truva Go',
  type: 'variable', status: 'publish', purchasable: true, price: '3199', regular_price: '3199',
  stock_status: 'instock', manage_stock: true, stock_quantity: 30, images: [],
  categories: [{ id: 1, slug: 'bottles', name: 'Bottles' }],
  attributes: [{ id: 1, name: 'Colour', variation: true, options: ['Grey', 'Pink', 'Blue'] }],
  variations: [7101, 7102, 7103] };
const children = ['GY', 'PK', 'BL'].map((colour, index) => ({ id: 7101 + index,
  parent_id: 10001, sku: `UC-BOG-TRB-009-${colour}`, status: 'publish', purchasable: true,
  price: '3199', stock_status: 'instock', manage_stock: true, stock_quantity: 10,
  attributes: [{ id: 1, name: 'Colour', option: ['Grey', 'Pink', 'Blue'][index] }] }));
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json'); res.setHeader('X-WP-TotalPages', '1');
  if (req.method !== 'GET') { res.writeHead(403); res.end('{"error":"Read-only fixture"}'); return; }
  const path = new URL(req.url, 'http://fixture.invalid').pathname;
  let data;
  if (/\/products\/10001\/variations\/\d+$/.test(path)) data = children.find(c => path.endsWith('/' + c.id));
  else if (path.endsWith('/products/10001/variations')) data = children;
  else if (path.endsWith('/products/10001')) data = parent;
  else if (path.endsWith('/products')) data = [parent];
  else if (path.endsWith('/products/categories')) data = [{ id: 1, slug: 'bottles', name: 'Bottles' }];
  else if (path.endsWith('/orders') || path.endsWith('/customers')) data = [];
  if (data === undefined) { res.writeHead(404); res.end('{"error":"Fixture record unavailable"}'); return; }
  res.end(JSON.stringify(data));
});
server.listen(Number(process.env.TEST_GUEST_CATALOGUE_PORT || 39001), '127.0.0.1', () => console.log('Read-only guest catalogue fixture ready'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit()));
