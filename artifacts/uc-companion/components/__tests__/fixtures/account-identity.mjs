let user = { id: 4, email: 'fixture@test.invalid', firstName: 'Fixture', lastName: '', phone: '', address: '' };
export function setUser(id) { user = { ...user, id }; }
export function useAuth() { return { user, logout: async () => {}, updateUser: async () => {} }; }
export function useColors() { return { primary: '#0054a6', background: '#fff', text: '#111' }; }
export function useApi() { return {}; }
export function getNotificationPermissionStatus() { return Promise.resolve('denied'); }
export function requestNotificationPermission() { return Promise.resolve(false); }
export function getFilterActivation() { return Promise.resolve(null); }
export function hydrateAssignedFilter() { return Promise.resolve(null); }
export function useFilterStatus() { return { activation: null }; }
export function useCartBarInset() { return 0; }
export function useRewardsQrToken() { return {}; }
export function CountryPicker() {}
export const customerQueryKeys = new Proxy({}, { get: (_t, key) => id => [key, id] });
export function clearProfileDraft() {}
export function loadProfileDraft() {}
export function preserveProfileDraftAfterSaveError() {}
export function saveProfileDraft() {}
export const PROFILE_SESSION_EXPIRED_MESSAGE = '', PROFILE_SIGN_IN_AGAIN_LABEL = '';
export function useRouter() { return {}; }
export function useLocalSearchParams() { return {}; }
export function useFocusEffect() {}
export const ImpactFeedbackStyle = {};
export function impactAsync() { return Promise.resolve(); }
export function shareAsync() {}
export function normalizeInstantPhone() {}
export function isValidInstantPhone() {}
export function useQueryClient() { return { invalidateQueries() {} }; }
export function useQuery({ queryKey }) {
  const data = queryKey[0] === 'customer-filter-assignments' ? [{ id: 4, productName: 'Assigned Hydra Flux', installationDate: '2026-01-01' }]
    : queryKey[0] === 'rewards' ? { balance: 0, ledger: [], impact: { filters: [], history: [], totalLitres: 0 } } : [];
  return { data, isLoading: false, isError: false, refetch: async () => {} };
}
export default function Empty() { return null; }
