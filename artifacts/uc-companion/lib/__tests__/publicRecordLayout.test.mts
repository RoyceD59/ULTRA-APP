import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPublicRecordLayout } from '../publicRecordLayout.ts';
import { optimizedProductImageUrl } from '../productImageUrl.ts';

function documentFixture(ready: string[] = [], hasFallback = true) {
  const result = { naturalFlow: false, fallbackRemoved: false, rootShown: false };
  const document = {
    documentElement: { toggleAttribute: (_key: string, value: boolean) => { result.naturalFlow = value; } },
    querySelectorAll: () => ready.map(path => ({ getAttribute: () => path })),
    getElementById: (id: string) => id === 'root'
      ? { removeAttribute: () => { result.rootShown = true; } }
      : hasFallback ? { remove: () => { result.fallbackRemoved = true; } } : null,
  } as unknown as Document;
  return { document, result };
}
test('an interactive deep link cannot be returned to zero-height fallback layout by a parent effect', () => {
  const { document, result } = documentFixture(['/product/viva-drop']);
  syncPublicRecordLayout('/product/viva-drop', document);
  assert.deepEqual(result, { naturalFlow: false, fallbackRemoved: true, rootShown: true });
});
test('pending products and topics retain the readable public document', () => {
  for (const path of ['/product/viva-drop', '/topic/bottles']) {
    const { document, result } = documentFixture();
    syncPublicRecordLayout(path, document);
    assert.deepEqual(result, { naturalFlow: true, fallbackRemoved: false, rootShown: false });
  }
});
test('an older retained stack page is not readiness evidence for another route', () => {
  const { document, result } = documentFixture(['/product/viva-drop']);
  syncPublicRecordLayout('/product/sweet-home', document);
  assert.equal(result.naturalFlow, true);
  assert.equal(result.fallbackRemoved, false);
});
test('non-record navigation restores the interactive viewport', () => {
  const { document, result } = documentFixture();
  syncPublicRecordLayout('/products', document);
  assert.equal(result.naturalFlow, false);
  assert.equal(result.rootShown, true);
});
test('client-side navigation without a public fallback never collapses loading or error screens', () => {
  const { document, result } = documentFixture([], false);
  syncPublicRecordLayout('/product/not-yet-loaded', document);
  assert.equal(result.naturalFlow, false);
  assert.equal(result.rootShown, true);
});
test('public photos share server-sized CDN keys and preserve existing query strings', () => {
  const src = 'https://media.example/api/storage/objects/uploads/123?w=5';
  assert.equal(optimizedProductImageUrl(src, 201), optimizedProductImageUrl(src, 256));
  assert.equal(new URL(optimizedProductImageUrl(src, 900)).searchParams.get('w'), '768');
  const catalogue = new URL(optimizedProductImageUrl('https://media.example/api/uc/product-images/photo.jpg', 80));
  assert.equal(catalogue.searchParams.get('w'), '128');
  assert.equal(catalogue.searchParams.get('fmt'), 'webp');
  assert.equal(optimizedProductImageUrl('https://other.example/photo.jpg', 90), 'https://other.example/photo.jpg');
});
