export const STORE_CATEGORIES = [
  'All',
  'Bottles & On-the-Go',
  'Home & Kitchen',
  'Skincare & Wellness',
  'Business & Community',
] as const;

export type StoreCategory = (typeof STORE_CATEGORIES)[number];

/** Normalize labels so WooCommerce names and the app's visible labels can match. */
export function normalizeStoreCategory(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/filters?/g, 'filter')
    .replace(/bottles?/g, 'bottle')
    .replace(/portable/g, 'portable')
    .replace(/showers?/g, 'shower')
    .replace(/skins?/g, 'skin')
    .replace(/accessories/g, 'accessory')
    .replace(/solutions?/g, 'solution')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Legacy storefront labels stay as aliases so older links and cached category
// names still land on the matching tab.
const CATEGORY_ALIASES: Record<Exclude<StoreCategory, 'All'>, string[]> = {
  'Bottles & On-the-Go': ['bottle portable', 'bottle portable filter', 'portable filter', 'water bottle'],
  'Home & Kitchen': ['home filter', 'household filter', 'faucet filter', 'under sink'],
  'Skincare & Wellness': ['shower skin', 'shower filter', 'skin filter', 'bathroom filter'],
  'Business & Community': ['solution', 'solutions', 'commercial', 'water treatment'],
};

export function categoryAliases(category: Exclude<StoreCategory, 'All'>): string[] {
  return [normalizeStoreCategory(category), ...CATEGORY_ALIASES[category].map(normalizeStoreCategory)];
}

/** Convert a WooCommerce category label into one of the app's visible tabs. */
export function visibleStoreCategory(value: string): StoreCategory | null {
  if (value.trim().toLowerCase() === 'all') return 'All';
  const normalized = normalizeStoreCategory(value);
  if (!normalized) return null;
  for (const category of STORE_CATEGORIES) {
    if (category === 'All') continue;
    if (categoryAliases(category).some(alias =>
      normalized === alias || normalized.includes(alias) || alias.includes(normalized)
    )) {
      return category;
    }
  }
  return null;
}