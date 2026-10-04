import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  });
}

test('Companion runtime code uses direct icon families, never the eager barrel', () => {
  for (const directory of ['app', 'components', 'hooks', 'lib', 'context']) {
    for (const filename of files(path.join(root, directory)).filter(f => /\.[cm]?[jt]sx?$/.test(f))) {
      const text = fs.readFileSync(filename, 'utf8');
      assert.doesNotMatch(text, /(?:from\s*|require\(\s*)['"]@expo\/vector-icons['"]/,
        `${path.relative(root, filename)} would ship unused icon families`);
    }
  }
});

test('direct icon entrypoints re-export the same component as the public barrel', () => {
  const packageRoot = path.join(root, 'node_modules/@expo/vector-icons');
  const barrel = fs.readFileSync(path.join(packageRoot, 'build/Icons.js'), 'utf8');
  for (const family of ['Ionicons', 'Feather']) {
    const entry = path.join(packageRoot, `${family}.js`);
    assert.match(fs.readFileSync(entry, 'utf8'),
      new RegExp(`import ${family} from './build/${family}';\\s*export default ${family};`));
    assert.match(barrel, new RegExp(`export \\{ default as ${family} \\} from './${family}'`));
  }
});