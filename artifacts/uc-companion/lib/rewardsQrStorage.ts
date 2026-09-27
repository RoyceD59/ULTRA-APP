import * as SecureStore from 'expo-secure-store';

const storageKey = (userId: number) => `uc-rewards-qr-token:${userId}`;

/** The opaque QR token is account-scoped and kept out of ordinary AsyncStorage. */
export function readStoredRewardsQrToken(userId: number): Promise<string | null> {
  return SecureStore.getItemAsync(storageKey(userId));
}

export function storeRewardsQrToken(userId: number, token: string): Promise<void> {
  if (!token.trim()) return Promise.resolve();
  return SecureStore.setItemAsync(storageKey(userId), token.trim());
}