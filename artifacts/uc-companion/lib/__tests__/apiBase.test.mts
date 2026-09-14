import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getApiBase } from '../apiBase.js';

function withEnv(
  values: { api?: string; domain?: string },
  callback: () => void,
): void {
  const previousApi = process.env.EXPO_PUBLIC_API_DOMAIN;
  const previousDomain = process.env.EXPO_PUBLIC_DOMAIN;
  const previousNodeEnv = process.env.NODE_ENV;

  if (values.api === undefined) delete process.env.EXPO_PUBLIC_API_DOMAIN;
  else process.env.EXPO_PUBLIC_API_DOMAIN = values.api;
  if (values.domain === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
  else process.env.EXPO_PUBLIC_DOMAIN = values.domain;
  process.env.NODE_ENV = 'test';

  try {
    callback();
  } finally {
    if (previousApi === undefined) delete process.env.EXPO_PUBLIC_API_DOMAIN;
    else process.env.EXPO_PUBLIC_API_DOMAIN = previousApi;
    if (previousDomain === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
    else process.env.EXPO_PUBLIC_DOMAIN = previousDomain;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

describe('getApiBase', () => {
  test('uses the separate production API hostname before the app hostname', () => {
    withEnv(
      { api: 'api.ucfilters.com', domain: 'app.ucfilters.com' },
      () => assert.equal(getApiBase(), 'https://api.ucfilters.com'),
    );
  });

  test('keeps an explicitly supplied protocol and removes trailing slashes', () => {
    withEnv(
      { api: 'http://localhost:8080///', domain: 'app.ucfilters.com' },
      () => assert.equal(getApiBase(), 'http://localhost:8080'),
    );
  });

  test('falls back to the development deployment hostname', () => {
    withEnv(
      { domain: 'dev.example.test' },
      () => assert.equal(getApiBase(), 'https://dev.example.test'),
    );
  });

  test('returns an empty origin when no development API is configured', () => {
    withEnv({}, () => assert.equal(getApiBase(), ''));
  });

  test('fails explicitly for a production build without an API hostname', () => {
    withEnv({}, () => {
      process.env.NODE_ENV = 'production';
      assert.throws(
        () => getApiBase(),
        /missing EXPO_PUBLIC_API_DOMAIN/,
      );
    });
  });
});