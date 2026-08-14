import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CartItem,
  CART_STORAGE_KEY,
  loadCartFromStorage,
  mergeItem,
  totalItems as calcTotalItems,
  totalPrice as calcTotalPrice,
} from './cartStorage';

export type { CartItem };

/** How long to wait before surfacing the "Couldn't load" error UI (ms). */
const HYDRATION_TIMEOUT_MS = 8000;

interface CartContextValue {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
  /** True once the cart has been read from AsyncStorage at least once. */
  cartHydrated: boolean;
  /**
   * True when a storage read has failed twice AND hydration has not yet
   * succeeded.  The cart/checkout screens show a Retry button instead of an
   * endless spinner in this case.
   */
  cartLoadError: boolean;
  addItem: (product: CartItem) => void;
  removeItem: (id: number) => void;
  updateQty: (id: number, qty: number) => void;
  clearCart: () => void;
  /** Re-read cart from AsyncStorage.  Call on tab focus to guarantee fresh data. */
  refreshCart: () => Promise<void>;
}

const CartContext = createContext<CartContextValue>({
  items: [],
  totalItems: 0,
  totalPrice: 0,
  cartHydrated: false,
  cartLoadError: false,
  addItem: () => {},
  removeItem: () => {},
  updateQty: () => {},
  clearCart: () => {},
  refreshCart: async () => {},
});

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [cartLoadError, setCartLoadError] = useState(false);

  // Write-versioning that guards refreshCart() against the tab-switch race:
  // `version` increments synchronously at each mutation call (stepper tap,
  // add, remove, clear) and that unique version is passed explicitly to the
  // persistence layer.  Writes are SERIALIZED on a promise chain, a write is
  // skipped when a newer mutation has superseded it (only the newest snapshot
  // can commit, so concurrent AsyncStorage writes can never settle out of
  // order), and `savedVersion` advances once that exact write SETTLES —
  // success, or failure after one retry.  Settling on failure matters: if a
  // failed save left savedVersion behind forever, every later refreshCart()
  // would be silently skipped and cross-screen changes would never appear.
  // A refresh may only overwrite in-memory state when nothing mutated since
  // it started AND storage had caught up when the read completed — otherwise
  // freshly tapped quantities would be clobbered by stale data.
  // (Plain object via useState initializer: stable identity, like a ref.)
  const [writeSync] = useState(() => ({
    version: 0,
    savedVersion: 0,
    chain: Promise.resolve(),
  }));

  const persist = useCallback((next: CartItem[], v: number) => {
    writeSync.chain = writeSync.chain.then(async () => {
      // Superseded by a newer mutation whose write is queued behind us:
      // skip this stale snapshot so it can never become the final value.
      if (v < writeSync.version) return;
      try {
        await AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
        if (v > writeSync.savedVersion) writeSync.savedVersion = v;
      } catch {
        // Failed write: retry once — a transient I/O error should not lose
        // the snapshot if storage recovers immediately.
        try {
          await AsyncStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
          if (v > writeSync.savedVersion) writeSync.savedVersion = v;
        } catch {
          // Still failing: mark this version as SETTLED anyway.  If we left
          // savedVersion behind, every future refreshCart() would be silently
          // skipped forever (savedAtRead could never catch up), so cross-screen
          // cart changes would stop appearing.  Accepting the (already-lost)
          // write as settled keeps refresh alive; the in-memory state remains
          // correct and the next successful save re-persists it.
          if (v > writeSync.savedVersion) writeSync.savedVersion = v;
        }
      }
    });
  }, [writeSync]);

  const loadFromStorage = useCallback(async () => {
    const versionAtStart = writeSync.version;

    // Each call to loadFromStorage arms its own watchdog.  `settled` is a
    // closure-local flag that prevents the timeout from flipping the UI into
    // the error state after the read has already completed (success OR failure).
    // This means every attempt — including retries — gets a fresh 8-second
    // window, so a hanging retry can never leave the shopper on an endless
    // spinner.
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) setCartLoadError(true);
    }, HYDRATION_TIMEOUT_MS);

    try {
      // loadCartFromStorage retries a failed read once internally; a second
      // failure throws and lands in the catch below.
      const loaded = await loadCartFromStorage(AsyncStorage);
      settled = true;
      clearTimeout(timeoutId);
      // Snapshot how far storage had caught up when the read completed; if the
      // save chain only settles later, `loaded` predates it and must not win.
      const savedAtRead = writeSync.savedVersion;
      setItems(prev => {
        const isStale =
          writeSync.version !== versionAtStart ||  // mutated since refresh began
          savedAtRead < versionAtStart;            // read happened before the last save settled
        return isStale ? prev : loaded;
      });
      setCartLoadError(false);
      setCartHydrated(true);
    } catch {
      settled = true;
      clearTimeout(timeoutId);
      // Read failed twice: we genuinely don't know what's in the saved cart.
      // Do NOT mark the cart as hydrated — asserting "your basket is empty"
      // on a transient storage error would be a lie.  On first load the UI
      // keeps its neutral loading state; if we were already hydrated (e.g. a
      // foreground refresh failed) the previous in-memory items stay visible.
      // Surface the error so cart/checkout can show a Retry button instead of
      // an endless spinner.
      setCartLoadError(true);
    }
  }, [writeSync]);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  // Low-memory resume guard: on Android the OS can purge the JS context while
  // the app is backgrounded; on return the whole context re-initialises and
  // cartHydrated resets to false.  Re-read storage whenever the app comes back
  // to the foreground so the UI never briefly shows a stale empty state while
  // waiting for a screen-level focus effect to fire.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      // Fire on any inactive/background → active transition ('inactive' covers
      // iOS interruptions; Android reports 'background').
      if (next === 'active' && prev !== 'active') {
        loadFromStorage();
      }
    });
    return () => sub.remove();
  }, [loadFromStorage]);

  const addItem = useCallback((product: CartItem) => {
    const v = ++writeSync.version;
    setItems(prev => {
      const next = mergeItem(prev, product);
      persist(next, v);
      return next;
    });
  }, [writeSync, persist]);

  const removeItem = useCallback((id: number) => {
    const v = ++writeSync.version;
    setItems(prev => {
      const next = prev.filter(i => i.id !== id);
      persist(next, v);
      return next;
    });
  }, [writeSync, persist]);

  const updateQty = useCallback((id: number, qty: number) => {
    if (qty <= 0) { removeItem(id); return; }
    const v = ++writeSync.version;
    setItems(prev => {
      const next = prev.map(i => i.id === id ? { ...i, quantity: qty } : i);
      persist(next, v);
      return next;
    });
  }, [removeItem, writeSync, persist]);

  const clearCart = useCallback(() => {
    const v = ++writeSync.version;
    setItems([]);
    persist([], v);
  }, [writeSync, persist]);

  // refreshCart clears any prior error flag before retrying the load so the UI
  // reverts to a spinner (rather than staying on the error screen) during the
  // attempt.  The flag is re-set by loadFromStorage if the retry also fails.
  const refreshCart = useCallback(async () => {
    setCartLoadError(false);
    await loadFromStorage();
  }, [loadFromStorage]);

  return (
    <CartContext.Provider value={{
      items,
      totalItems: calcTotalItems(items),
      totalPrice: calcTotalPrice(items),
      cartHydrated,
      cartLoadError,
      addItem,
      removeItem,
      updateQty,
      clearCart,
      refreshCart,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
