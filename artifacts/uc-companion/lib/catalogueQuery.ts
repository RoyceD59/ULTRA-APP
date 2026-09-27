export interface CatalogueParams {
  category?: string;
  search?: string;
}

export const CATALOGUE_SEARCH_DEBOUNCE_MS = 300;

export function normalizeCatalogueParams(params: CatalogueParams = {}): CatalogueParams {
  const category = params.category?.trim();
  const search = params.search?.trim();
  return {
    ...(category ? { category } : {}),
    ...(search ? { search } : {}),
  };
}

export function catalogueQueryKey(params: CatalogueParams = {}) {
  const normalized = normalizeCatalogueParams(params);
  return ['products', 'catalogue', normalized.category ?? '', normalized.search ?? ''] as const;
}

export function scheduleCatalogueSearch(
  value: string,
  settle: (value: string) => void,
  delay = CATALOGUE_SEARCH_DEBOUNCE_MS,
): () => void {
  const timer = setTimeout(() => settle(value), delay);
  return () => clearTimeout(timer);
}