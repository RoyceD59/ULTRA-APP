import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, describe, it } from 'node:test';
import { __testRender } from '../../__mocks__/react.ts';
import { __setPlatform } from '../../__mocks__/react-native.ts';

const require = createRequire(import.meta.url);
const Bubble = require('../AlisonWelcomeBubble.tsx').default;

function find(tree: any, testID: string): any {
  if (!tree || typeof tree !== 'object') return undefined;
  if (tree.props?.testID === testID) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const match = find(child, testID);
    if (match) return match;
  }
}

afterEach(() => __setPlatform('ios'));

describe('Alison welcome bubble callback and accessibility contracts (stub rendering)', () => {
  for (const platform of ['ios', 'android', 'web'] as const) {
    it(`provides welcome, separate chat/dismiss buttons and cart clearance on ${platform}`, () => {
      __setPlatform(platform);
      let opens = 0;
      let dismissals = 0;
      const root = __testRender(() => ({ props: { value: Bubble({
        bottom: 104, onOpen: () => opens++, onDismiss: () => dismissals++,
      }) } }), {});
      try {
        const bubble = find(root.value, 'products-alison-nudge');
        assert.equal(bubble.props.style[0].position, 'absolute');
        assert.equal(bubble.props.style[1].bottom, 104);
        assert.match(JSON.stringify(root.value), /Hi, I’m Alison!/);
        const open = find(root.value, 'products-alison-nudge-open');
        const dismiss = find(root.value, 'products-alison-nudge-dismiss');
        assert.equal(open.props.accessibilityRole, 'button');
        assert.match(open.props.accessibilityLabel, /Chat with Alison/);
        assert.equal(dismiss.props.accessibilityRole, 'button');
        assert.equal(dismiss.props.style.width, 44);
        assert.equal(dismiss.props.style.height, 44);
        open.props.onPress();
        assert.equal(opens, 1);
        assert.equal(dismissals, 0);
        dismiss.props.onPress();
        assert.equal(opens, 1);
        assert.equal(dismissals, 1);
      } finally { root.dispose(); }
    });
  }
});