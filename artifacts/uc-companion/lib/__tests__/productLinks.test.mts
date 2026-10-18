import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeExternalHref, linkifyText, productHref, topicHref, categoryHref, enquiryHref } from '../productLinks.js';

test('only safe protocols are accepted', () => {
  assert.equal(safeExternalHref('https://ucfilters.co.ke/x'), 'https://ucfilters.co.ke/x');
  assert.equal(safeExternalHref('mailto:care@example.com'), 'mailto:care@example.com');
  assert.equal(safeExternalHref('tel:+254712345678'), 'tel:+254712345678');
  assert.equal(safeExternalHref('javascript:alert(1)'), null);
  assert.equal(safeExternalHref('JavaScript:alert(1)'), null);
  assert.equal(safeExternalHref('data:text/html,hi'), null);
  assert.equal(safeExternalHref('//evil.example'), null);
  assert.equal(safeExternalHref('https://a b'), null);
  assert.equal(safeExternalHref(42), null);
});

test('linkify only links explicit authored URLs and strips trailing punctuation', () => {
  const parts = linkifyText('See https://example.com/guide. Call tel:+254712345678 or 0712 345 678.');
  assert.deepEqual(parts, [
    { text: 'See ' },
    { text: 'https://example.com/guide', href: 'https://example.com/guide' },
    { text: '. Call ' },
    { text: 'tel:+254712345678', href: 'tel:+254712345678' },
    { text: ' or 0712 345 678.' },
  ]);
  assert.deepEqual(linkifyText('javascript:alert(1) example.com'), [{ text: 'javascript:alert(1) example.com' }]);
});

test('internal hrefs are encoded and reject unsafe slugs', () => {
  assert.equal(productHref('uc-pitcher'), '/product/uc-pitcher');
  assert.equal(productHref('uc-pitcher', 'UC-1 BLUE'), '/product/uc-pitcher?sku=UC-1%20BLUE');
  assert.equal(productHref('../admin'), null);
  assert.equal(productHref('javascript:x'), null);
  assert.equal(topicHref('hard-water'), '/topic/hard-water');
  assert.equal(categoryHref('Under sink'), '/products?category=Under%20sink');
  assert.equal(enquiryHref(null, 'A & B'), '/enquiry?productId=&productName=A%20%26%20B');
});
