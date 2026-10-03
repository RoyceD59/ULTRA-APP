/** Poll only shared catalogue/content data; private queries refresh on return. */
export const GLOBAL_IMPACT_QUERY_KEY = ['impact', 'global'] as const;

export function sharedDataRefreshInterval(key: readonly unknown[]): number | false {
  const [resource, section] = key;
  const shared = ['products', 'product', 'promotions', 'locations', 'locationRatings', 'compatibility'].includes(String(resource))
    || (resource === 'companion' && ['blog', 'guides', 'guide'].includes(String(section)))
    || (resource === 'impact' && section === 'global');
  return shared ? 60_000 : false;
}
