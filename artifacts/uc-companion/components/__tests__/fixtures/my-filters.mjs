let user = { id: 41 };
let model;
export const calls = { invalidations: 0, retries: [], navigation: [] };
export function setUser(id) { user = id == null ? null : { id }; }
export function setModel(value) { model = value; }
export function useAuth() { return { user }; }
export function useMyFilters() { return model; }
export function useColors() {
  return { text: '#111', primary: '#0054A6', primaryForeground: '#fff', primaryLight: '#d9eef8', mutedForeground: '#555', card: '#fff', surface: '#eee', border: '#ccc' };
}
export function useRouter() { return { push: route => calls.navigation.push(route) }; }
export function RegisterModal() { return null; }
export function source(name, options = {}) {
  return { data: { purchases: [] }, isSuccess: true, isLoading: false, isPending: false, isFetching: false, isError: false,
    refetch: () => calls.retries.push(name), ...options };
}
export function configure(ready, overrides = {}) {
  calls.invalidations = 0; calls.retries = []; calls.navigation = [];
  model = { ready, other: [], history: [], online: source('online'), offline: source('offline'),
    assignments: source('assignments'), registrations: source('registrations'),
    refresh: () => calls.retries.push('all'), invalidate: () => calls.invalidations++, ...overrides };
  return model;
}
