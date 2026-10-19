import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const source = readFileSync(new URL('../../components/product/ProductPhoto.tsx', import.meta.url), 'utf8');

for (const platform of ['ios', 'android']) test(`${platform} uses measured native frames, tries a derivative then original bytes, and stops loading after success`, () => {
  const values = [false, false, true, 0, { width: 358, height: 358 }, ''];
  let cursor = 0;
  const effects = [];
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'react') return { ...React, useState: () => {
      const index = cursor++;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    }, useEffect: fn => effects.push(fn) };
    if (name === 'react-native') return {
      Platform: { OS: platform }, Image: 'NativeImage', View: 'View', Text: 'Text',
      ActivityIndicator: 'Spinner', TouchableOpacity: 'Button', StyleSheet: { create: v => v },
    };
    if (name === 'expo-image') return { Image: 'ExpoImage' };
    if (name.includes('useApi')) return { resizedImageUrl: () => 'https://example.test/photo.webp?w=768', resolveMediaUrl: () => 'https://example.test/original.jpg' };
    return { P: {} };
  }, module, module.exports);
  const render = () => {
    cursor = 0; effects.length = 0;
    return module.exports.default({ src: '/photo', alt: 'Kitchen tap', width: 520 });
  };
  let image = render().props.children[0];
  assert.equal(image.type, 'NativeImage');
  assert.equal(image.props.source.uri, 'https://example.test/photo.webp?w=768');
  assert.deepEqual(image.props.style, { width: 358, height: 358 });
  image.props.onError({ nativeEvent: { error: 'Image format error' } });
  image = render().props.children[0];
  assert.equal(image.props.source.uri, 'https://example.test/original.jpg');
  image.props.onLoad(); render();
  assert.equal(effects[1](), undefined, 'loaded image must not arm a failure timer');
  image.props.onError({ nativeEvent: { error: '404' } });
  const retry = render().props.children[0];
  assert.equal(retry.type, 'Button');
  assert.equal(retry.props.accessibilityLabel, 'Retry photo: Kitchen tap');
  retry.props.onPress();
  assert.equal(render().props.children[0].props.source.uri, 'https://example.test/original.jpg');
});
