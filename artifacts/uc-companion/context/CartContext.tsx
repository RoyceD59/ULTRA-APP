import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CartItem {
  id: number;
  name: string;
  price: number;
  quantity: number;
  image: string;
  sku: string;
}

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

const CART_KEY = 'uc_cart_v1';

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);

  const loadFromStorage = useCallback(async () => {
    try {
      const data = await AsyncStorage.getItem(CART_KEY);
      if (data) setItems(JSON.parse(data));
    } catch { /* ignore */ } finally {
      setCartHydrated(true);
    }
  }, []);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const persist = (next: CartItem[]) => {
    setItems(next);
    AsyncStorage.setItem(CART_KEY, JSON.stringify(next)).catch(() => {});
  };

  const addItem = (product: CartItem) => {
    setItems(prev => {
      const existing = prev.find(i => i.id === product.id);
      const next = existing
        ? prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
        : [...prev, { ...product, quantity: 1 }];
      AsyncStorage.setItem(CART_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const removeItem = (id: number) => persist(items.filter(i => i.id !== id));

  const updateQty = (id: number, qty: number) => {
    if (qty <= 0) { removeItem(id); return; }
    persist(items.map(i => i.id === id ? { ...i, quantity: qty } : i));
  };

  const clearCart = () => persist([]);

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);
  const totalPrice = items.reduce((s, i) => s + i.price * i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, totalItems, totalPrice, cartHydrated, addItem, removeItem, updateQty, clearCart, refreshCart: loadFromStorage }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
