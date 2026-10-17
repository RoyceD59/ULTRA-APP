import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = (file) => readFileSync(new URL(file, `file://${root}`), 'utf8');
function elements(file, tag) {
  const tree = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === tag) {
      matches.push({
        node,
        text: node.getText(tree),
        attribute: (name) => node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(tree) === name)?.initializer?.getText(tree),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return matches;
}

test('enquiry shared Field uses the persistent visible label, including multiline and prefilled inputs', () => {
  const inputs = elements('app/enquiry.tsx', 'TextInput');
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].attribute('accessibilityLabel'), '{label}');
  const fields = elements('app/enquiry.tsx', 'Field');
  assert.equal(fields.length, 4);
  assert.ok(fields.every((field) => field.attribute('label')));
  assert.ok(fields.some((field) => field.text.includes('multiline')));
});

test('every assessment, booking and verification TextInput has a persistent accessible name', () => {
  const inputs = elements('app/water-test.tsx', 'TextInput');
  assert.deepEqual(inputs.map((input) => input.attribute('accessibilityLabel')), [
    '"First name *"', '"WhatsApp *"', '"Town / area *"', '"Free water test code (optional)"',
    '"Service Address *"', '"Preferred Contact Time *"', '"6-digit code"',
  ]);
  for (const input of inputs) {
    const label = JSON.parse(input.attribute('accessibilityLabel'));
    assert.ok(source('app/water-test.tsx').includes(`>${label}</Text>`), `Visible label missing: ${label}`);
  }
});

test('product gallery forwards API alternatives and explicitly exposes meaningful images', () => {
  const photos = elements('app/product/[id].tsx', 'Image').filter((image) => image.text.includes('slide.src, galleryContainerWidth'));
  assert.equal(photos.length, 1);
  assert.equal(photos[0].attribute('accessibilityLabel'), '{slide.alt}');
  assert.ok(photos[0].node.attributes.properties.some((prop) => prop.name?.getText() === 'accessible'));
  const thumbnails = elements('app/product/[id].tsx', 'Image').filter((image) => image.text.includes('slide.src, 56'));
  assert.equal(thumbnails[0].attribute('accessible'), '{false}');
  assert.ok(thumbnails[0].text.includes('aria-hidden'));
});

test('public titles and content sections specify heading levels', () => {
  const cases = [
    ['app/about.tsx', 'styles.title', 1],
    ['app/about.tsx', 'styles.h2', 2],
    ['app/about.tsx', 'styles.h3', 2],
    ['app/product/[id].tsx', 'styles.name', 1],
    ['app/product/[id].tsx', 'styles.sectionLabel', 2],
    ['app/guide/[id].tsx', 'styles.heroTitle', 1],
    ['app/(tabs)/blog.tsx', 'styles.headerTitle', 1],
  ];
  for (const [file, style, level] of cases) {
    const titles = elements(file, 'Text').filter((element) => element.text.includes(style));
    assert.ok(titles.length > 0, `${file}: ${style}`);
    assert.ok(titles.every((title) => title.text.includes(`...headingProps(${level})`)), `${file}: ${style}`);
  }
});

test('guide heading surrounds the named accordion button on web instead of becoming a button descendant', () => {
  const wrappers = elements('app/guide/[id].tsx', 'View')
    .filter((element) => element.text.includes("Platform.OS === 'web' ? headingProps(2)"));
  assert.equal(wrappers.length, 1);
  const child = wrappers[0].node.parent.children.find(ts.isJsxElement);
  assert.equal(child.openingElement.tagName.getText(), 'TouchableOpacity');
  const button = elements('app/guide/[id].tsx', 'TouchableOpacity')
    .find((element) => element.attribute('accessibilityLabel') === '{section.heading}');
  assert.equal(button.attribute('accessibilityRole'), '"button"');
  assert.equal(button.attribute('accessibilityState'), '{{ expanded: open }}');
  assert.equal(button.attribute('aria-expanded'), '{open}');
  assert.equal(button.attribute('onPress'), '{toggle}');
});

test('light muted text meets normal-text contrast on light surfaces without changing the dark token', () => {
  const js = ts.transpileModule(source('constants/colors.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', js)(module, module.exports);
  const palette = module.exports.default;
  function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels.reduce((total, value, i) => total + value * [0.2126, 0.7152, 0.0722][i], 0);
  }
  for (const key of ['background', 'card', 'surface', 'muted', 'secondary', 'primaryLight']) {
    const values = [luminance(palette.light.mutedForeground), luminance(palette.light[key])].sort((a, b) => a - b);
    const ratio = (values[1] + 0.05) / (values[0] + 0.05);
    assert.ok(ratio >= 4.5, `${key}: ${ratio.toFixed(2)}:1`);
  }
  assert.equal(palette.dark.mutedForeground, '#6B8AAA');
});

test('installed web renderer produces h1/h2 and accessible input names from the new props', () => {
  // Run without the native hook-test stubs registered by the package test runner.
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const ts = require('typescript');
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const web = require('react-native-web');
    const js = ts.transpileModule(fs.readFileSync('lib/accessibility.ts', 'utf8'),
      {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
    const mod = {exports: {}};
    new Function('require', 'module', 'exports', js)(
      (name) => name === 'react-native' ? {Platform: {OS: 'web'}} : require(name), mod, mod.exports);
    const { headingProps } = mod.exports;
    assert.match(renderToStaticMarkup(React.createElement(web.Text, headingProps(1), 'Title')), /<h1[^>]*role="heading"/);
    const accordion = renderToStaticMarkup(React.createElement(web.View, headingProps(2),
      React.createElement(web.TouchableOpacity, {
        accessibilityRole: 'button', accessibilityLabel: 'Installation',
        accessibilityState: {expanded: false}, 'aria-expanded': false, onPress() {}
      }, React.createElement(web.Text, null, 'Installation'))));
    assert.match(accordion, /<h2[^>]*role="heading"/);
    assert.match(accordion, /role="button"/);
    assert.match(accordion, /aria-expanded="false"/);
    assert.match(accordion, /<button[^>]*type="button"/);
    assert.match(renderToStaticMarkup(React.createElement(web.TextInput, {
      accessibilityLabel: 'First name *', value: 'Amara'
    })), /aria-label="First name \\*"/);
    assert.match(renderToStaticMarkup(React.createElement(web.TextInput, {
      accessibilityLabel: 'Message', multiline: true, value: 'My enquiry'
    })), /<textarea[^>]*aria-label="Message"/);
  `], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});