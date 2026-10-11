// Compile the supplied schema without adding a runtime dependency to the
// standalone server (frozen releases intentionally remove stage node_modules).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Ajv = require('ajv/dist/2020');
const standalone = require('ajv/dist/standalone').default;
const directory = path.resolve(__dirname, '../server/records');
const schemaText = fs.readFileSync(path.join(directory, 'product_content_v2.6.schema.json'), 'utf8');
const ajv = new Ajv({ strict: false, allErrors: true, code: { source: true } });
const validate = ajv.compile(JSON.parse(schemaText));
const hash = crypto.createHash('sha256').update(schemaText).digest('hex');
const code = `// Generated from the supplied v2.6 schema; run scripts/generate-product-validator.cjs.\n${standalone(ajv, validate)}\nmodule.exports.schemaHash = '${hash}';\n`;
const target = path.join(directory, 'validate-products.cjs');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== code) throw new Error('Product validator is stale');
} else {
  fs.writeFileSync(target, code);
}
