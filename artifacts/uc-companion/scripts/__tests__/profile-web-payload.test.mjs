import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { profilePayload, assertPhoneGraph, assertCompanionOnly } = require('../profile-web-payload.cjs');
const helperImport = 'import { normalizeInstantPhone, isValidInstantPhone } from "@workspace/api-zod/instant-water-identity";';
const facadeImport = 'import { parsePhoneNumberFromString } from "./phone-runtime.js";';
const runtime = '/lib/api-zod/src/phone-runtime.js';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-graph-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const web = path.join(directory, '_expo/static/js/web');
  fs.mkdirSync(web, { recursive: true });
  const modules = {
    'entry.js': [['/artifacts/uc-companion/app/_layout.tsx', 'export default function Layout() {}']],
    'shared.js': [
      [runtime, '// libphonenumber-js facade retains ordinary formatting\nexport const parsePhoneNumberFromString = () => {};'],
      ['/lib/api-zod/src/phone.ts', `import type { CountryCode } from "libphonenumber-js";\n${facadeImport}`],
      ['/lib/api-zod/src/instant-water-identity.ts', facadeImport],
    ],
    'checkout.js': [['/artifacts/uc-companion/app/checkout.tsx', helperImport]],
    'register.js': [['/artifacts/uc-companion/app/auth/register.tsx', helperImport]],
  };
  function write() {
    for (const [script, entries] of Object.entries(modules)) {
      fs.writeFileSync(path.join(web, script), '// exported JS');
      fs.writeFileSync(path.join(web, `${script}.map`), JSON.stringify({
        version: 3, sources: entries.map(([source]) => source),
        sourcesContent: entries.map(([, content]) => content), mappings: '',
      }));
    }
  }
  const initialScripts = ['entry.js', 'shared.js'].map(name => ({ name, raw: 10, gzip: 8, brotli: 7 }));
  function check() {
    write();
    return assertPhoneGraph(profilePayload(directory, initialScripts), directory);
  }
  return { directory, web, modules, initialScripts, write, check };
}

test('initial scripts and deferred checkout/registration share exactly one phone facade', t => {
  const f = fixture(t);
  // pnpm paths and Windows separators must normalize to the same package.
  f.modules['shared.js'].push([
    'C:\\repo\\node_modules\\.pnpm\\libphonenumber-js@1.0\\node_modules\\libphonenumber-js\\es6\\format.js',
    'export default function format() {}',
  ]);
  const report = f.check();
  assert.equal(report.sharedModules.facade.script, 'shared.js');
  assert.equal(report.sharedModules.checkout.script, 'checkout.js');
  assert.equal(report.sharedModules.registration.script, 'register.js');
  assert.equal(report.checkedExportedScripts, 4);
  assert.deepEqual(report.checkedInitialScripts, ['entry.js', 'shared.js']);
});

for (const name of [
  'AsYouType.js', 'AsYouTypeFormatter.PatternMatcher.js', 'AsYouTypeParser.js',
  'PhoneNumberMatcher.js', 'findNumbers/index.js', 'findNumbers/RegExpCache.js',
  'searchNumbers.js', 'findPhoneNumbersInText.js', 'searchPhoneNumbersInText.js',
]) {
  test(`rejects ${name} reintroduced through a broad barrel in initial scripts`, t => {
    const f = fixture(t);
    f.modules['entry.js'].push([
      `/repo/node_modules/.pnpm/libphonenumber-js@1.0/node_modules/libphonenumber-js/es6/${name}`,
      'export default function unused() {}',
    ]);
    assert.throws(f.check, /Unused phone formatting\/search modules in initial scripts/);
  });
}

test('only initially requested scripts trigger the unused-module check', t => {
  const f = fixture(t);
  f.modules['checkout.js'].push(['/repo/node_modules/libphonenumber-js/es6/AsYouType.js', 'export const x = 1;']);
  assert.doesNotThrow(f.check);
});

test('duplicate or missing facade and missing deferred routes fail closed', t => {
  const f = fixture(t);
  f.modules['register.js'].push([runtime, 'export const copied = true;']);
  assert.throws(f.check, /one shared facade.*found 2/);
  f.modules['register.js'].pop();
  const facade = f.modules['shared.js'].shift();
  assert.throws(f.check, /one shared facade.*found 0/);
  f.modules['shared.js'].unshift(facade);
  f.modules['register.js'] = [];
  assert.throws(f.check, /Missing source inventory/);
});

test('consumer imports are checked as syntax, not comments or type-only imports', t => {
  const f = fixture(t);
  f.modules['register.js'][0][1] = `// ${helperImport}\nexport const noPhone = true;`;
  assert.throws(f.check, /registration no longer uses/);
  f.modules['register.js'][0][1] = helperImport.replace('import {', 'import type {');
  assert.throws(f.check, /registration no longer uses/);
  f.modules['register.js'][0][1] = helperImport;
  f.modules['shared.js'][2][1] = `${facadeImport}\nimport { parsePhoneNumber } from "libphonenumber-js/min";`;
  assert.throws(f.check, /identity bypasses/);
  f.modules['shared.js'][2][1] = '// import { parsePhoneNumber } from "libphonenumber-js";\n' + facadeImport;
  assert.doesNotThrow(f.check);
});

test('both shared helpers must still import the facade parser', t => {
  const f = fixture(t);
  f.modules['shared.js'][1][1] = 'export const normalizeInternationalPhone = () => null;';
  assert.throws(f.check, /phone no longer uses the shared phone facade/);
});

test('missing maps, content, scripts and incomplete initial inventories cannot pass', t => {
  const f = fixture(t);
  f.write();
  fs.unlinkSync(path.join(f.web, 'register.js.map'));
  assert.throws(() => assertPhoneGraph(profilePayload(f.directory, f.initialScripts), f.directory), /ENOENT/);
  f.write();
  fs.writeFileSync(path.join(f.web, 'register.js.map'), '{broken');
  assert.throws(() => assertPhoneGraph(profilePayload(f.directory, f.initialScripts), f.directory), SyntaxError);
  f.modules['register.js'][0][1] = null;
  assert.throws(f.check, /Missing phone graph source content/);
  f.modules['register.js'][0][1] = helperImport;
  f.write();
  fs.unlinkSync(path.join(f.web, 'entry.js'));
  assert.throws(() => assertPhoneGraph(profilePayload(f.directory, f.initialScripts), f.directory), /Initial script is missing/);
  f.write();
  assert.throws(() => profilePayload(f.directory, []), /No initially requested scripts/);
  assert.throws(() => profilePayload(f.directory, [f.initialScripts[0], f.initialScripts[0]]), /unique/);
  assert.throws(() => profilePayload(f.directory, [{ name: '../entry.js' }]), /unique/);
  assert.throws(() => assertPhoneGraph(profilePayload(f.directory, [f.initialScripts[0]]), f.directory), /facade is absent/);
});

test('CLI phone gate succeeds independently of team-API gate and exits nonzero on regression', t => {
  const f = fixture(t);
  f.write();
  const timings = path.join(f.directory, 'timings.json');
  const output = path.join(f.directory, 'profile.json');
  fs.writeFileSync(timings, JSON.stringify([{ initialScripts: f.initialScripts }]));
  const args = [path.resolve(import.meta.dirname, '../profile-web-payload.cjs'), f.directory, timings, output];
  const pass = spawnSync(process.execPath, [...args, '--assert-phone-graph'], { encoding: 'utf8' });
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output)).phoneGraph.sharedModules.facade.script, 'shared.js');
  assert.throws(() => assertCompanionOnly(profilePayload(f.directory, f.initialScripts)), /No API client modules/);
  f.modules['entry.js'].push(['/node_modules/libphonenumber-js/es6/AsYouType.js', 'export const x = 1;']);
  f.write();
  const fail = spawnSync(process.execPath, [...args, '--assert-phone-graph'], { encoding: 'utf8' });
  assert.notEqual(fail.status, 0);
  assert.match(fail.stderr, /Unused phone formatting\/search/);
});