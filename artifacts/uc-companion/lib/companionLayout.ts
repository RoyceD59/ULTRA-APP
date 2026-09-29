export const COMPANION_TABS = [
  { name: 'index', label: 'Home', icon: 'home-outline', href: '/' },
  { name: 'products', label: 'Products', icon: 'cart-outline', href: '/products' },
  { name: 'blog', label: 'Blog', icon: 'book-outline', href: '/blog' },
  { name: 'support', label: 'Support', icon: 'help-circle-outline', href: '/support' },
  { name: 'map', label: 'Map', icon: 'map-outline', href: '/map' },
  { name: 'account', label: 'Account', icon: 'person-outline', href: '/account' },
] as const;

export type CompanionTab = (typeof COMPANION_TABS)[number]['name'];

export function cartContentInset(hydrated: boolean, totalItems: number, safeBottom = 0, fontScale = 1) {
  return (hydrated && totalItems > 0 ? Math.max(112, 96 * fontScale) : 24) + safeBottom;
}

/** Window size, not device type: responds to rotation, split-screen and zoom. */
export function companionLayout(width: number, fontScale = 1) {
  const size = width < 600 ? 'compact' : width < 1024 ? 'medium' : 'expanded';
  const navigationWidth = size === 'compact' ? 0 : size === 'medium' ? 88 : 216;
  const contentWidth = Math.max(0, Math.min(1200, width - navigationWidth));
  const gutter = size === 'compact' ? 16 : 24;
  const gap = 12;
  // Large accessibility text gets fewer, wider cards rather than clipped labels.
  const minimumCardWidth = 156 * Math.max(1, fontScale);
  const columns = Math.max(1, Math.min(5, Math.floor((contentWidth - gutter * 2 + gap) / (minimumCardWidth + gap))));
  const cardWidth = Math.max(0, (contentWidth - gutter * 2 - gap * (columns - 1)) / columns);
  const articleColumns = Math.max(1, Math.min(3, Math.floor((contentWidth - gutter * 2 + gap) / (280 * Math.max(1, fontScale) + gap))));
  const articleWidth = Math.max(0, (contentWidth - gutter * 2 - gap * (articleColumns - 1)) / articleColumns);
  return { size, navigationWidth, contentWidth, gutter, gap, columns, cardWidth,
    articleColumns, articleWidth,
    bottomNavigationHeight: size === 'compact' ? Math.max(72, 44 + 22 * fontScale) : 0 } as const;
}
