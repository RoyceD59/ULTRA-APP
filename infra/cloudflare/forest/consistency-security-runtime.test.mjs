import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, get } from 'node:http';
import { stage } from './consistency-handoff.mjs';
import { resolve } from 'node:path';

function consumer(artifact, chain) {
  let require = createRequire(resolve(stage, 'artifacts', artifact, 'package.json'));
  for (const name of chain.slice(0, -1)) require = createRequire(require.resolve(name));
  return { require, name: chain.at(-1) };
}
const proxy = consumer('api-server', ['express', 'proxy-addr']);
const maps = consumer('uc-companion', ['expo', '@expo/metro-config', 'postcss', 'source-map-js']);
const gzip = consumer('uc-companion', ['expo', '@expo/cli', 'compression']);

test('actual frozen consumers resolve all three fixed, pinned patch releases', () => {
  for (const [library, version] of [[proxy, '2.0.8'], [maps, '1.2.2'], [gzip, '1.8.2']]) {
    assert.equal(library.require(`${library.name}/package.json`).version, version);
  }
});

test('proxy trust no longer accepts public IPv4 addresses under unsafe mapped IPv6 prefixes', () => {
  const compile = proxy.require(proxy.name).compile;
  assert.equal(compile('::ffff:10.0.0.0/8')('203.0.113.9'), false);
  assert.equal(compile('::/1')('203.0.113.9'), false);
  for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
    assert.equal(compile(subnet)('10.1.2.3'), true);
    assert.equal(compile(subnet)('203.0.113.9'), false);
  }
});

test('indexed source maps reject unbounded/invalid offsets and retain normal mapping', () => {
  const { SourceMapConsumer } = maps.require(maps.name);
  const indexed = line => ({
    version: 3, sections: [{ offset: { line, column: 0 },
      map: { version: 3, names: [], sources: ['fixture.js'], mappings: 'AAAA' } }],
  });
  for (const line of [2 ** 31, -1, 0.5, Infinity, NaN]) {
    assert.throws(() => new SourceMapConsumer(indexed(line)), /offset/i);
  }
  const small = new SourceMapConsumer(indexed(0).sections[0].map);
  assert.deepEqual(small.originalPositionFor({ line: 1, column: 0 }),
    { source: 'fixture.js', line: 1, column: 0, name: null });
  const mappings = [];
  new SourceMapConsumer(indexed(0)).eachMapping(mapping => mappings.push(mapping));
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].source, 'fixture.js');
});

test('compression keeps gzip output and releases its stream on premature response close', { timeout: 6000 }, async () => {
  const entry = gzip.require.resolve(gzip.name);
  const local = createRequire(entry);
  const destroyPath = local.resolve('destroy');
  const destroy = local('destroy');
  const destroyed = [];
  local.cache[destroyPath].exports = stream => {
    if (stream) destroyed.push(stream);
    return destroy(stream);
  };
  delete gzip.require.cache[entry];
  const compression = gzip.require(gzip.name)({ threshold: 0 });
  let closed = false;
  const server = createServer((req, res) => compression(req, res, () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url !== '/abort') return res.end(JSON.stringify({ ok: true, text: 'x'.repeat(4096) }));
    const timer = setInterval(() => { res.write('x'.repeat(1024)); res.flush(); }, 10);
    res.once('close', () => { closed = true; clearInterval(timer); });
  }));
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const normal = await fetch(origin, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(normal.headers.get('content-encoding'), 'gzip');
    assert.equal((await normal.json()).text.length, 4096);
    destroyed.length = 0;
    await new Promise((done, reject) => {
      const request = get(`${origin}/abort`, { headers: { 'Accept-Encoding': 'gzip' } }, response => {
        response.once('data', () => { request.destroy(); done(); });
      });
      request.once('error', error => error.code === 'ECONNRESET' ? done() : reject(error));
    });
    for (let i = 0; i < 40 && !closed; i++) await new Promise(done => setTimeout(done, 20));
    assert.ok(closed);
    assert.ok(destroyed.some(stream => stream.destroyed), 'aborted gzip stream must be destroyed');
  } finally {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    local.cache[destroyPath].exports = destroy;
    delete gzip.require.cache[entry];
  }
});
