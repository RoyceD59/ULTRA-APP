import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const source = readFileSync(new URL('../../components/product/ProductPhoto.tsx', import.meta.url), 'utf8');

for (const platform of ['ios', 'android']) test(`${platform} uses measured native frames and original photos; loaded images do not time out`, () => {
  const values = [false, false, false, 0, { width: 358, height: 358 }, ''];
  const effects = [];
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'react') return { ...React, useState: () => [values.shift(), () => {}], useEffect: fn => effects.push(fn) };
    if (name === 'react-native') return {
      Platform: { OS: platform }, Image: 'NativeImage', View: 'View', Text: 'Text',
      ActivityIndicator: 'Spinner', TouchableOpacity: 'Button', StyleSheet: { create: v => v },
    };
    if (name === 'expo-image') return { Image: 'ExpoImage' };
    if (name.includes('useApi')) return { resizedImageUrl: () => 'https://example.test/photo.webp?w=768', resolveMediaUrl: () => 'https://example.test/original.jpg' };
    return { P: {} };
  }, module, module.exports);
  const tree = module.exports.default({ src: '/photo', alt: 'Kitchen tap', width: 520 });
  const image = tree.props.children[0];
  assert.equal(image.type, 'NativeImage');
  assert.equal(image.props.source.uri, 'https://example.test/original.jpg');
  assert.deepEqual(image.props.style, { width: 358, height: 358 });
  assert.equal(effects[1](), undefined, 'loaded image must not arm a failure timer');
});
