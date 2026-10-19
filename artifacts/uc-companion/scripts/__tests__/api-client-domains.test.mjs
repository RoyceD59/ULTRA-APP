import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const client = path.resolve(root, '../../lib/api-client-react/src');
const domains = ['auth', 'customer', 'hydration', 'water-check'];

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  });
}

function tokens(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const result = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) result.push(scanner.getTokenText());
  return JSON.stringify(result);
}

function exports(filename) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  return new Map(source.statements.flatMap(statement => {
    if (!statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return [];
    const names = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.map(d => d.name.getText(source))
      : statement.name ? [statement.name.getText(source)] : [];
    return names.map(name => [name, tokens(statement.getText(source))]);
  }));
}

test('customer domain exports retain every legacy request, hook, option, and query-key contract', () => {
  const legacy = exports(path.join(client, 'generated/api.ts'));
  for (const domain of domains) {
    const filename = path.join(client, `companion-generated/companion-${domain}/companion-${domain}.ts`);
    const text = fs.readFileSync(filename, 'utf8');
    assert.match(text, /from ['"]\.\.\/\.\.\/custom-fetch['"]/);
    assert.doesNotMatch(text, /\/api\/(?:admin|projects|tasks|members)|\/api\/uc\/(?:admin|editor|offline-clients)/);
    const generated = exports(filename);
    assert.ok(generated.size > 0);
    for (const [name, contract] of generated) {
      assert.equal(contract, legacy.get(name), `${domain}: ${name} changed`);
    }
  }
});

test('customer models retain legacy type and enum values', () => {
  const legacy = exports(path.join(client, 'generated/api.schemas.ts'));
  for (const filename of files(path.join(client, 'companion-generated/models'))) {
    for (const [name, contract] of exports(filename)) {
      assert.equal(contract, legacy.get(name), `${name} changed`);
    }
  }
});

test('Companion cannot import the eager root API barrel or private generated paths', () => {
  for (const directory of ['app', 'components', 'hooks', 'lib', 'context']) {
    for (const filename of files(path.join(root, directory)).filter(f => /\.[cm]?[jt]sx?$/.test(f))) {
      if (filename.includes('__tests__')) continue;
      assert.doesNotMatch(fs.readFileSync(filename, 'utf8'),
        /(?:from\s*|require\(\s*|import\(\s*)['"]@workspace\/api-client-react(?:['"]|\/src\/|\/generated\/)/,
        path.relative(root, filename));
    }
  }
});

test('config and all public domains share one auth/base-URL state with the legacy client', async () => {
  const config = await import('@workspace/api-client-react/config');
  const legacy = await import('@workspace/api-client-react');
  const auth = await import('@workspace/api-client-react/companion/auth');
  const customer = await import('@workspace/api-client-react/companion/customer');
  const hydration = await import('@workspace/api-client-react/companion/hydration');
  const water = await import('@workspace/api-client-react/companion/water-check');
  assert.equal(config.setBaseUrl, legacy.setBaseUrl);
  assert.equal(config.setAuthTokenGetter, legacy.setAuthTokenGetter);
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  try {
    config.setBaseUrl('https://customer.example');
    config.setAuthTokenGetter(() => 'test-session');
    await auth.completeUcTemporaryPasswordChange({ newPassword: 'test-password' });
    await customer.getHydrateCustomerTree();
    await hydration.getUcDailyHydration('2026-10-04');
    await water.consumeInstantWaterAssessmentHandoff({ handoffToken: 'fixture' });
    await legacy.getHydrateCustomerTree();
    assert.equal(calls.length, 5);
    for (const call of calls) {
      assert.ok(call.url.startsWith('https://customer.example/api/'));
      assert.equal(new Headers(call.options.headers).get('authorization'), 'Bearer test-session');
    }
    config.setAuthTokenGetter(null);
    legacy.setBaseUrl('https://next.example');
    await hydration.saveUcDailyHydration('2026-10-04', { litres: 1 });
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { litres: 1 });
    assert.ok(calls.at(-1).url.startsWith('https://next.example/api/'));
    assert.equal(new Headers(calls.at(-1).options.headers).get('authorization'), null);
    const mutation = water.getConsumeInstantWaterAssessmentHandoffMutationOptions();
    await mutation.mutationFn({ data: { handoffToken: 'next' } });
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { handoffToken: 'next' });
  } finally {
    config.setBaseUrl(null);
    config.setAuthTokenGetter(null);
    globalThis.fetch = realFetch;
  }
});

test('initial payload guard rejects the legacy graph and sums every requested script', () => {
  const { profilePayload, assertCompanionOnly } = require('../profile-web-payload.cjs');
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'uc-api-profile-test-'));
  try {
    const mapDir = path.join(directory, '_expo/static/js/web');
    fs.mkdirSync(mapDir, { recursive: true });
    const scripts = ['entry.js', 'common.js'].map(name => ({ name, raw: 10, gzip: 5, brotli: 4 }));
    for (const script of scripts) fs.writeFileSync(path.join(mapDir, `${script.name}.map`),
      JSON.stringify({ sources: ['lib/api-client-react/src/custom-fetch.ts'], sourcesContent: ['shared'] }));
    const report = profilePayload(directory, scripts);
    assert.deepEqual(report.initialBytes, { raw: 20, gzip: 10, brotli: 8 });
    assertCompanionOnly(report);
    fs.writeFileSync(path.join(mapDir, 'common.js.map'), JSON.stringify({
      sources: ['lib/api-client-react/src/generated/api.ts'], sourcesContent: ['team'],
    }));
    assert.throws(() => assertCompanionOnly(profilePayload(directory, scripts)), /team API barrel/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
