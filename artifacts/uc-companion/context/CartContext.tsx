import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CartItem,
  loadCartFromStorage,
  saveCartToStorage,
  mergeItem,
  totalItems as calcTotalItems,
  totalPrice as calcTotalPrice,
} from './cartStorage';

export type { CartItem };

interface CartContextValue {
  items: CartItem[];
  totalItems: number;
  totalPrice: number;
  /** True once the cart has been read from AsyncStorage at least once. */
  cartHydrated: boolean;
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
  addItem: () => {},
  removeItem: () => {},
  updateQty: () => {},
  clearCart: () => {},
  refreshCart: async () => {},
});

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);

  const loadFromStorage = useCallback(async () => {
    try {
      const loaded = await loadCartFromStorage(AsyncStorage);
      setItems(loaded);
    } finally {
      setCartHydrated(true);
    }
  }, []);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const addItem = useCallback((product: CartItem) => {
    setItems(prev => {
      const next = mergeItem(prev, product);
      saveCartToStorage(AsyncStorage, next);
      return next;
    });
  }, []);

  const removeItem = useCallback((id: number) => {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id);
      saveCartToStorage(AsyncStorage, next);
      return next;
    });
  }, []);

  const updateQty = useCallback((id: number, qty: number) => {
    if (qty <= 0) { removeItem(id); return; }
    setItems(prev => {
      const next = prev.map(i => i.id === id ? { ...i, quantity: qty } : i);
      saveCartToStorage(AsyncStorage, next);
      return next;
    });
  }, [removeItem]);

  const clearCart = useCallback(() => {
    setItems([]);
    saveCartToStorage(AsyncStorage, []);
  }, []);

  return (
    <CartContext.Provider value={{
      items,
      totalItems: calcTotalItems(items),
      totalPrice: calcTotalPrice(items),
      cartHydrated,
      addItem,
      removeItem,
      updateQty,
      clearCart,
      refreshCart: loadFromStorage,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
