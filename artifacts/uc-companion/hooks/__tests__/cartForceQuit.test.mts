/**
 * Cold-launch regression: exercise the real CartProvider's mutation paths,
 * then discard the provider and mount a fresh one over surviving storage.
 * This tests settled writes, not physical OS termination or native disk I/O.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __testRender } from 'react';
import { __resetAppState } from 'react-native';
import { _reset, _storage } from '@react-native-async-storage/async-storage';
import { CartProvider, type CartItem } from '../../context/CartContext.js';
import { CART_STORAGE_KEY } from '../../context/cartStorage.js';

const A: CartItem = {
  id: 1, name: 'Inline Filter', price: 3500, quantity: 1,
  image: 'https://example.com/inline.png', sku: 'IF-001',
};
const B: CartItem = {
  id: 2, name: 'Shower Filter', price: 2800, quantity: 1,
  image: 'https://example.com/shower.png', sku: 'SF-001',
};

interface CartValue {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
  cartHydrated: boolean;
  addItem: (item: CartItem) => void;
  updateQty: (id: number, qty: number) => void;
  removeItem: (id: number) => void;
  clearCart: () => void;
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function mountCart() {
  const root = __testRender<{ children: null }, CartValue>(
    CartProvider as any, { children: null },
  );
  assert.equal(root.value.cartHydrated, false, 'cold launch starts unhydrated');
  await tick();
  root.flush();
  assert.equal(root.value.cartHydrated, true);
  return root;
}

beforeEach(() => {
  _reset();
  __resetAppState();
});

describe('cart survives a fresh provider before checkout completes', () => {
  const cases: {
    name: string;
    mutate: (cart: CartValue) => void;
    expected: CartItem[];
  }[] = [
    { name: 'adding another product', mutate: cart => cart.addItem(B), expected: [A, B] },
    {
      name: 'adding an existing product',
      mutate: cart => cart.addItem(A),
      expected: [{ ...A, quantity: 2 }],
    },
    {
      name: 'changing quantity',
      mutate: cart => cart.updateQty(A.id, 4),
      expected: [{ ...A, quantity: 4 }],
    },
    { name: 'removing a product', mutate: cart => cart.removeItem(A.id), expected: [] },
    { name: 'setting quantity to zero', mutate: cart => cart.updateQty(A.id, 0), expected: [] },
    { name: 'explicitly clearing the cart', mutate: cart => cart.clearCart(), expected: [] },
  ];

  for (const scenario of cases) {
    it(`persists ${scenario.name} and restores it without a background event`, async () => {
      const original = await mountCart();
      original.value.addItem(A);
      original.flush();
      await tick();
      assert.deepEqual(JSON.parse(_storage.get(CART_STORAGE_KEY)!), [A]);

      scenario.mutate(original.value);
      original.flush();
      await tick();
      assert.deepEqual(
        JSON.parse(_storage.get(CART_STORAGE_KEY)!),
        scenario.expected,
        'mutation must save without relying on checkout completion or AppState',
      );
      original.dispose();

      // Keep only storage, not the previous provider's state or callbacks.
      const relaunched = await mountCart();
      try {
        assert.deepEqual(relaunched.value.items, scenario.expected);
        assert.equal(
          relaunched.value.totalItems,
          scenario.expected.reduce((sum, item) => sum + item.quantity, 0),
        );
        assert.equal(
          relaunched.value.totalPrice,
          scenario.expected.reduce((sum, item) => sum + item.price * item.quantity, 0),
        );
      } finally {
        relaunched.dispose();
      }
    });
  }
});