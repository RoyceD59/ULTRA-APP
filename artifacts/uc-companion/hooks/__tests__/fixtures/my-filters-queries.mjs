let id = 41;
export const reads = [];
export const cancelled = [];
export const invalidated = [];
export const queries = new Map();
export const controllers = new Map();
export function setAccount(value) { id = value; }
export function useAuth() { return { user: { id } }; }
export function useApi() {
  const owner = id;
  return {
    getOfflinePurchases(signal) { reads.push({ owner, signal, source: 'offline' }); return Promise.resolve({ purchases: [] }); },
    getAssignments(signal) { reads.push({ owner, signal, source: 'assignments' }); return Promise.resolve([]); },
    getRewards(signal) { reads.push({ owner, signal, source: 'rewards' }); return Promise.resolve({ impact: { filters: [] } }); },
  };
}
export function useQuery(options) {
  queries.set(JSON.stringify(options.queryKey), options);
  return { data: undefined, refetch() {}, isError: false };
}
export function useActivationPurchases() {
  return { data: { purchases: [] }, refetch() {} };
}
export function useFocusEffect() {}
export function useQueryClient() {
  return {
    cancelQueries({ queryKey, exact }) {
      cancelled.push({ queryKey, exact });
      controllers.get(JSON.stringify(queryKey))?.abort();
      return Promise.resolve();
    },
    invalidateQueries({ queryKey }) { invalidated.push(queryKey); return Promise.resolve(); },
  };
}
