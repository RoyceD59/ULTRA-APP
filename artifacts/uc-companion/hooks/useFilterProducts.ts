/**
 * useFilterProducts — catalogue-driven list of trackable filter products.
 *
 * The filter tracker (picker + reminder scheduling) reads product names and
 * rated lifespans from `/api/uc/products` so it can never drift out of sync
 * with the catalogue. Resolution order:
 *
 *   1. Live API  — products with `lifespanDays > 0` (trackable filters)
 *   2. AsyncStorage cache — last successful fetch, keeps the picker offline
 *   3. Static fallback — last-resort snapshot bundled with the app
 *
 * Icons are presentation-only and derived client-side from the category.
 */
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApi, UCProduct } from '@/hooks/useApi';

const CACHE_KEY = 'uc_filter_products_cache';

export interface FilterProduct {
  id: number;
  name: string;
  lifespanDays: number;
  icon: string;
}

/** Category → Ionicons icon for the picker rows. */
function iconForProduct(p: Pick<UCProduct, 'categories' | 'name'>): string {
  const cat = p.categories?.[0]?.name ?? '';
  if (/shower|skin/i.test(cat))   return 'sparkles-outline';
  if (/home/i.test(cat))          return 'home-outline';
  if (/accessor/i.test(cat))      return 'construct-outline';
  if (/solution/i.test(cat))      return 'business-outline';
  if (/straw/i.test(p.name))      return 'funnel-outline';
  return 'water-outline';
}

export function toFilterProducts(products: UCProduct[]): FilterProduct[] {
  return products
    .filter(p => typeof p.lifespanDays === 'number' && p.lifespanDays > 0)
    .map(p => ({
      id: p.id,
      name: p.name,
      lifespanDays: p.lifespanDays as number,
      icon: iconForProduct(p),
    }));
}

/**
 * Last-resort static snapshot (2026 catalogue) used only when the API is
 * unreachable AND no cached copy exists (e.g. first launch offline).
 */
export const FALLBACK_FILTER_PRODUCTS: FilterProduct[] = [
  { id: 1,  name: 'Hydra Flux',              lifespanDays:  90, icon: 'water-outline'    },
  { id: 2,  name: 'Truva Go',                lifespanDays:  90, icon: 'water-outline'    },
  { id: 3,  name: 'Viva Drop',               lifespanDays:  90, icon: 'water-outline'    },
  { id: 4,  name: 'Flex',                    lifespanDays:  90, icon: 'water-outline'    },
  { id: 5,  name: 'Timbo',                   lifespanDays:  90, icon: 'water-outline'    },
  { id: 6,  name: 'Gym Buddy',               lifespanDays:  90, icon: 'water-outline'    },
  { id: 7,  name: 'Survivor Straw',          lifespanDays: 120, icon: 'funnel-outline'   },
  { id: 8,  name: 'Breeze',                  lifespanDays:  90, icon: 'water-outline'    },
  { id: 9,  name: 'EcoSmart Elite',          lifespanDays:  90, icon: 'flash-outline'    },
  { id: 11, name: 'Sweet Home',              lifespanDays: 120, icon: 'home-outline'     },
  { id: 12, name: 'Counter Reverse Osmosis', lifespanDays: 180, icon: 'home-outline'     },
  { id: 13, name: 'Electric Pitcher',        lifespanDays:  90, icon: 'home-outline'     },
  { id: 15, name: "J'adore",                 lifespanDays: 150, icon: 'sparkles-outline' },
  { id: 16, name: 'Channel',                 lifespanDays: 135, icon: 'sparkles-outline' },
  { id: 17, name: 'Derma Care',              lifespanDays: 150, icon: 'sparkles-outline' },
  { id: 18, name: 'Pure Drop',               lifespanDays: 150, icon: 'sparkles-outline' },
  { id: 19, name: 'Derma Flux',              lifespanDays: 135, icon: 'sparkles-outline' },
];

async function readCache(): Promise<FilterProduct[] | null> {
  try {
    const s = await AsyncStorage.getItem(CACHE_KEY);
    if (!s) return null;
    const parsed = JSON.parse(s) as FilterProduct[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch { return null; }
}

/** Where the currently returned product list originated. */
export type FilterProductSource = 'live' | 'cache' | 'fallback';

/**
 * Hook returning the trackable filter products.
 * Shows the cache (or static fallback) immediately, then refreshes from the
 * API in the background and re-renders when fresh data arrives.
 *
 * `source` indicates the origin of the current list:
 *   'live'     — just fetched successfully from the API
 *   'cache'    — loaded from AsyncStorage (API not yet reached or offline)
 *   'fallback' — neither API nor cache available; using bundled snapshot
 */
export function useFilterProducts(): {
  products: FilterProduct[];
  loading: boolean;
  source: FilterProductSource;
} {
  const api = useApi();
  // useApi returns fresh function identities each render; keep the latest in a
  // ref so the fetch effect runs once without capturing a stale closure.
  const getProductsRef = useRef(api.getProducts);
  getProductsRef.current = api.getProducts;

  const [products, setProducts] = useState<FilterProduct[]>(FALLBACK_FILTER_PRODUCTS);
  const [loading, setLoading]   = useState(true);
  const [source, setSource]     = useState<FilterProductSource>('fallback');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Cached copy first, so the picker is instantly usable offline
      const cached = await readCache();
      if (cached && !cancelled) {
        setProducts(cached);
        setSource('cache');
      }

      // 2. Refresh from the live catalogue
      try {
        const fresh = toFilterProducts(await getProductsRef.current());
        if (fresh.length > 0) {
          if (!cancelled) {
            setProducts(fresh);
            setSource('live');
          }
          try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh)); } catch { /* cache write is best-effort */ }
        }
      } catch { /* offline — cached / fallback list stays; source unchanged */ }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  return { products, loading, source };
}
