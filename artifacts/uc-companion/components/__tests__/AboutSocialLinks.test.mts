import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { __testRender } from '../../__mocks__/react.ts';
import { Linking, __setPlatform, __setColorScheme } from '../../__mocks__/react-native.ts';
const require = createRequire(import.meta.url);
const AboutSocialLinks = require('../AboutSocialLinks.tsx').default;
const colors = require('../../constants/colors.ts').default;

const destinations = [
  ['Instagram', 'https://www.instagram.com/ultra_clear_filtration_tech?stkn=MTJrYTk3bXd1bHRoYw%3D%3D&utm_source=qr'],
  ['TikTok', 'https://www.tiktok.com/@ultra_clear?_r=1&_t=ZS-9AGJ0kmeUjs'],
  ['Facebook', 'https://www.facebook.com/share/1C1caWuQ17/?mibextid=wwXIfr'],
  ['YouTube', 'https://www.youtube.com/@UltraClear'],
] as const;

function render() {
  return __testRender(() => ({ props: { value: AboutSocialLinks() } }), {});
}

function find(tree: any, testID: string): any {
  if (!tree || typeof tree !== 'object') return undefined;
  if (tree.props?.testID === testID) return tree;
  const children = [tree.props?.children].flat(Infinity);
  for (const child of children) {
    const match = find(child, testID);
    if (match) return match;
  }
}

afterEach(() => {
  mock.restoreAll();
  __setPlatform('ios');
  __setColorScheme('light');
});

describe('About social links', () => {
  for (const platform of ['web', 'ios', 'android'] as const) {
    it(`opens each exact URL with named link semantics on ${platform}`, async () => {
      __setPlatform(platform);
      const calls: string[] = [];
      mock.method(Linking, 'openURL', async (url: string) => { calls.push(url); });
      const root = render();
      try {
        for (const [name, url] of destinations) {
          const link = find(root.value, `about-social-${name.toLowerCase()}`);
          assert.equal(link.props.accessibilityRole, 'link');
          assert.equal(link.props.accessibilityLabel, `Follow Ultra Clear on ${name}`);
          assert.equal(link.props.tabIndex, platform === 'web' ? 0 : undefined);
          assert.equal(link.props.href, platform === 'web' ? url : undefined);
          assert.equal(link.props.children.props.name, `logo-${name.toLowerCase()}`);
          assert.equal(link.props.children.props.accessible, false);
          assert.ok(link.props.style[0].width >= 44);
          assert.ok(link.props.style[0].height >= 44);
          let prevented = false;
          await link.props.onPress({ preventDefault() { prevented = true; } });
          assert.equal(prevented, platform === 'web');
          assert.equal(calls.at(-1), url);
        }
        assert.equal(calls.length, 4);
        assert.equal(find(root.value, 'about-social-error'), undefined);
        const row = root.value.props.children[1];
        assert.equal(row.props.style.flexWrap, 'wrap');
        assert.ok(4 * 48 + 3 * row.props.style.gap <= 320 - 32);
      } finally {
        root.dispose();
      }
    });
  }

  for (const [name] of destinations) {
    it(`shows an inline ${name} failure and clears it on a successful retry`, async () => {
      let fail = true;
      mock.method(Linking, 'openURL', async () => {
        if (fail) throw new Error('External opener unavailable');
      });
      const root = render();
      try {
        const id = `about-social-${name.toLowerCase()}`;
        await find(root.value, id).props.onPress();
        root.flush();
        const error = find(root.value, 'about-social-error');
        assert.equal(error.props.accessibilityRole, 'alert');
        assert.equal(error.props.children, `Unable to open ${name}. Please try again.`);
        fail = false;
        await find(root.value, id).props.onPress();
        root.flush();
        assert.equal(find(root.value, 'about-social-error'), undefined);
      } finally {
        root.dispose();
      }
    });
  }

  it('shows and removes the themed keyboard-focus border on web', () => {
    __setPlatform('web');
    const root = render();
    try {
      const id = 'about-social-instagram';
      find(root.value, id).props.onFocus();
      root.flush();
      assert.equal(find(root.value, id).props.style[1].borderColor, colors.light.primary);
      find(root.value, id).props.onBlur();
      root.flush();
      assert.equal(find(root.value, id).props.style[1].borderColor, colors.light.border);
    } finally {
      root.dispose();
    }
  });

  it('uses dark theme colours without native web-only props', () => {
    __setColorScheme('dark');
    const root = render();
    try {
      for (const [name] of destinations) {
        const link = find(root.value, `about-social-${name.toLowerCase()}`);
        assert.equal(link.props.style[1].backgroundColor, colors.dark.card);
        assert.equal(link.props.children.props.color, colors.dark.primary);
        assert.equal(link.props.href, undefined);
      }
      assert.equal(root.value.props.children[0].props.style[1].color, colors.dark.text);
    } finally {
      root.dispose();
    }
  });
});