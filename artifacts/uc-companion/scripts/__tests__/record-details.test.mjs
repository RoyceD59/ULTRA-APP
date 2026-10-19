import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { renderRecordDetails } = require('../../server/record-details.cjs');
const { escapeHtml } = require('../../server/public-rendering.cjs');
test('non-JavaScript product delivery retains authored category layers and safe hyperlinks', () => {
  const body = renderRecordDetails({
    benefits: { headline: 'Benefit from record' }, suitability: { avoid: ['Not for salt water'] },
    claims: [{ text: 'Tested scope', conditions: 'Under the stated conditions' }],
    evidenceLimits: ['Limits are explicit'], package: { included: ['Actual part'] },
    ownership: { replacement: 'Actual interval' }, service: { support: 'https://example.org/support' },
    faq: [{ q: 'How?', a: 'Read https://example.org/guide' }],
  }, escapeHtml);
  for (const heading of ['Benefits', 'Suitability', 'Evidence and limits', 'Package and setup',
    'Ownership and replacement costs', 'Service and support', 'Questions and answers']) assert.ok(body.includes(heading));
  assert.match(body, /href="https:\/\/example.org\/guide"/);
  assert.match(body, /Not for salt water/);
});
test('authored HTML cannot execute and absent sections do not invent copy', () => {
  const body = renderRecordDetails({ benefits: { headline: '<script>attack()</script>' } }, escapeHtml);
  assert.doesNotMatch(body, /<script>/);
  assert.doesNotMatch(body, /Questions and answers/);
});
