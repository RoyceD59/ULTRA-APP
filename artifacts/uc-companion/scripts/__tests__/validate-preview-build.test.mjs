import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePreviewBuild } from '../validate-preview-build.mjs';

test('internal preview builds refuse production endpoints and missing staging origins', () => {
  const base = { UC_PREVIEW_BUILD: '1', EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example', EXPO_PUBLIC_DOMAIN: 'preview-app.example.test', EXPO_PUBLIC_API_DOMAIN: 'preview-api.example.test' };
  assert.doesNotThrow(() => validatePreviewBuild(base));
  assert.throws(() => validatePreviewBuild({ ...base, EXPO_PUBLIC_API_DOMAIN: 'api.ucfilters.com' }), /must not point/);
  assert.throws(() => validatePreviewBuild({ ...base, EXPO_PUBLIC_DOMAIN: 'app.ucfilters.com' }), /must not point/);
  assert.throws(() => validatePreviewBuild({ ...base, EXPO_PUBLIC_API_DOMAIN: '' }), /required/);
  assert.throws(() => validatePreviewBuild({ ...base, EXPO_PUBLIC_API_DOMAIN: 'http://preview-api.example.test' }), /HTTPS/);
  assert.throws(() => validatePreviewBuild({ ...base, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_example' }), /Clerk test/);
  assert.throws(() => validatePreviewBuild({ ...base, EXPO_PUBLIC_CLERK_PROXY_URL: 'https://app.ucfilters.com/clerk' }), /live Clerk proxy/);
});