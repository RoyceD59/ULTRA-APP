/**
 * cartStorage.ts — pure cart logic and a thin, injectable storage boundary.
 *
 * Split into two layers so both can be tested in Node without a React Native
 * runtime:
 *
 *   1. Pure helpers (mergeItem, totalItems, totalPrice) — no imports, no I/O.
 *      CartContext.addItem delegates its merge logic here.
 *
 *   2. Storage boundary (loadCartFromStorage, saveCartToStorage) — accepts any
 *      StorageBackend so tests can pass an in-memory store without any module-
 *      alias tricks.  CartContext passes the real AsyncStorage object.
 *
 * Importing this file from Node (tsx/esm) is safe; nothing here touches React
 * Native APIs directly.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
  image: string;
  sku: string;
}

/** Minimal subset of AsyncStorage that the storage boundary needs. */
export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const CART_STORAGE_KEY = 'uc_cart_v1';

// ── Storage boundary ──────────────────────────────────────────────────────────

/**
 * Read the cart from `storage`.
 * - A failed read (I/O error) is retried once, mirroring the write path's
 *   single retry.  If the retry also fails the error PROPAGATES so the caller
 *   can avoid asserting "the cart is empty" when it simply couldn't read.
 * - Corrupt data (parse error) returns [] — the stored value is genuinely
 *   unusable, so an empty cart is the honest answer.
 */
export async function loadCartFromStorage(storage: StorageBackend): Promise<CartItem[]> {
  let data: string | null;
  try {
    data = await storage.getItem(CART_STORAGE_KEY);
  } catch {
    // Transient I/O error: retry once.  A second failure propagates.
    data = await storage.getItem(CART_STORAGE_KEY);
  }
  if (!data) return [];
  try {
    return JSON.parse(data) as CartItem[];
  } catch {
    return [];
  }
}

/**
 * Write `items` to `storage`.  Errors are suppressed so a transient I/O
 * failure never propagates to the UI layer.
 */
export async function saveCartToStorage(
  storage: StorageBackend,
  items: CartItem[],
): Promise<void> {
  try {
    await storage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Return a new cart array that includes `product`.
 * - Already present → quantity incremented by 1.
 * - Not present     → appended with quantity = 1.
 * The input array is never mutated.
 */
export function mergeItem(items: CartItem[], product: CartItem): CartItem[] {
  const existing = items.find(i => i.id === product.id);
  if (existing) {
    return items.map(i =>
      i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i,
    );
  }
  return [...items, { ...product, quantity: 1 }];
}

/** Sum of all item quantities in the cart. */
export function totalItems(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.quantity, 0);
}

/** Sum of (price × quantity) for all items. */
export function totalPrice(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}
