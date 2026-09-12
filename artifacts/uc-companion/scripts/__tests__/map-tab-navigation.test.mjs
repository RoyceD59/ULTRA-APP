import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const layoutSource = readFileSync(join(appRoot, 'app', '(tabs)', '_layout.tsx'), 'utf8');
const swipeSource = readFileSync(join(appRoot, 'components', 'SwipeTabs.tsx'), 'utf8');

const TAB_NAMES = ['index', 'products', 'support', 'map', 'account'];

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

describe('Map tab-bar navigation contract', () => {
  test('NativeTabLayout exposes every tab, including Map, as a direct trigger', () => {
    for (const name of TAB_NAMES) {
      assert.match(
        layoutSource,
        new RegExp(`<NativeTabs\\.Trigger\\s+name=["']${name}["']>`),
        `${name} must remain directly reachable in the Liquid Glass tab bar`,
      );
    }

    assert.equal(
      countMatches(layoutSource, /<NativeTabs\.Trigger\s+name=["']map["']>/g),
      1,
      'Liquid Glass must render exactly one Map tab trigger',
    );
  });

  test('NativeTabLayout gives Map a visible selected state', () => {
    assert.match(
      layoutSource,
      /<NativeTabs\.Trigger\s+name=["']map["']>[\s\S]*?<Icon\s+sf=\{\{\s*default:\s*["']map["'],\s*selected:\s*["']map\.fill["']\s*\}\}\s*\/>[\s\S]*?<Label>Map<\/Label>[\s\S]*?<\/NativeTabs\.Trigger>/,
      'Map must retain its selected icon and label in the Liquid Glass tab bar',
    );
  });

  test('ClassicTabLayout exposes every tab, including Map, as a direct screen', () => {
    for (const name of TAB_NAMES) {
      assert.match(
        layoutSource,
        new RegExp(`<Tabs\\.Screen\\s+name=["']${name}["']`),
        `${name} must remain directly reachable in the classic tab bar`,
      );
    }

    assert.equal(
      countMatches(layoutSource, /<Tabs\.Screen\s+name=["']map["']/g),
      1,
      'ClassicTabLayout must render exactly one Map tab screen',
    );
  });

  test('ClassicTabLayout retains active and inactive highlighting', () => {
    assert.match(layoutSource, /tabBarActiveTintColor:\s*colors\.primary/);
    assert.match(layoutSource, /tabBarInactiveTintColor:\s*colors\.mutedForeground/);
    assert.match(
      layoutSource,
      /name=["']map["'][\s\S]*?title:\s*["']Map["'][\s\S]*?tabBarIcon:\s*\(\{\s*color\s*\}\)[\s\S]*?color=\{color\}/,
      'the Map icon must consume the navigator-provided active/inactive color',
    );
  });

  test('both native platforms have a Map route behind the tab trigger', () => {
    assert.equal(existsSync(join(appRoot, 'app', '(tabs)', 'map.native.tsx')), true);
    assert.equal(existsSync(join(appRoot, 'app', '(tabs)', 'map.tsx')), true);
  });

  test('swipe exclusion does not remove Map from tab order or tab layouts', () => {
    assert.match(swipeSource, /const\s+NON_SWIPE_TABS\s*=\s*new Set<SwipeTab>\(\[['"]map['"]\]\)/);
    assert.match(
      swipeSource,
      /const\s+TAB_ORDER\s*=\s*\[['"]index['"],\s*['"]products['"],\s*['"]support['"],\s*['"]map['"],\s*['"]account['"]\]/,
      'Map stays in tab order while being excluded only from swipe destinations',
    );
    assert.doesNotMatch(
      readFileSync(join(appRoot, 'app', '(tabs)', 'map.native.tsx'), 'utf8'),
      /<SwipeTabs\b/,
      'native Map must not intercept map panning with SwipeTabs',
    );
  });
});