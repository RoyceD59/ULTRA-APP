import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { createRequire } from 'node:module';
import { __testRender, useState } from '../../__mocks__/react.ts';

const require = createRequire(import.meta.url);
const { useAlisonNudge } = require('../useAlisonNudge.ts');

function mount() {
  return __testRender(() => {
    const [filter, setFilter] = useState({ search: '', category: 'All' });
    const [hasProducts, setHasProducts] = useState(true);
    const nudge = useAlisonNudge(filter.search.length > 0 || filter.category !== 'All', hasProducts);
    return { props: { value: { ...nudge, setFilter, setHasProducts } } };
  }, {});
}

afterEach(() => mock.timers.reset());

describe('Alison welcome bubble mounted-session behavior', () => {
  it('is absent at 7999 ms and eligible at 8000 ms', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const root = mount();
    try {
      assert.equal(root.value.visible, false);
      mock.timers.tick(7999);
      root.flush();
      assert.equal(root.value.visible, false);
      mock.timers.tick(1);
      root.flush();
      assert.equal(root.value.visible, true);
    } finally { root.dispose(); }
  });

  it('suppresses search and category filters without restarting the delay', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const root = mount();
    try {
      root.value.setFilter({ search: 'filter', category: 'All' });
      root.flush();
      mock.timers.tick(8000);
      root.flush();
      assert.equal(root.value.visible, false);
      root.value.setFilter({ search: '', category: 'All' });
      root.flush();
      assert.equal(root.value.visible, true);
      root.value.setFilter({ search: '', category: 'Filters' });
      root.flush();
      assert.equal(root.value.visible, false);
      root.value.setFilter({ search: '', category: 'All' });
      root.flush();
      assert.equal(root.value.visible, true);
    } finally { root.dispose(); }
  });

  it('stays dismissed after waiting and changing filters or product data', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const root = mount();
    try {
      mock.timers.tick(8000);
      root.flush();
      root.value.dismiss();
      root.flush();
      assert.equal(root.value.visible, false);
      root.value.setFilter({ search: 'filter', category: 'Filters' });
      root.value.setHasProducts(false);
      root.flush();
      root.value.setFilter({ search: '', category: 'All' });
      root.value.setHasProducts(true);
      root.flush();
      mock.timers.tick(60000);
      root.flush();
      assert.equal(root.value.visible, false);
    } finally { root.dispose(); }
  });

  it('does not reveal a dismissed bubble when its pending timer fires', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const root = mount();
    try {
      root.value.dismiss();
      root.flush();
      mock.timers.tick(8000);
      root.flush();
      assert.equal(root.value.visible, false);
    } finally { root.dispose(); }
  });

  it('waits for products, then reveals without another eight-second delay', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const root = mount();
    try {
      root.value.setHasProducts(false);
      root.flush();
      mock.timers.tick(8000);
      root.flush();
      assert.equal(root.value.visible, false);
      root.value.setHasProducts(true);
      root.flush();
      assert.equal(root.value.visible, true);
    } finally { root.dispose(); }
  });

  it('cleans up on unmount and resets dismissal on a fresh mount', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const first = mount();
    first.dispose();
    mock.timers.tick(8000);
    first.flush();
    assert.equal(first.value.visible, false);
    const second = mount();
    mock.timers.tick(8000);
    second.flush();
    second.value.dismiss();
    second.flush();
    second.dispose();
    const third = mount();
    try {
      assert.equal(third.value.visible, false);
      mock.timers.tick(8000);
      third.flush();
      assert.equal(third.value.visible, true);
    } finally { third.dispose(); }
  });
});