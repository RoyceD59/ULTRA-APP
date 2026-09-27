export async function resolveRewardsQrToken(
  userId: number,
  rewardsToken: string | null | undefined,
  apiRotate: () => Promise<{ qrToken: string }>,
  readLocal: (id: number) => Promise<string | null>,
  storeLocal: (id: number, token: string) => Promise<void>
): Promise<{ token: string; source: 'local' | 'rewards' | 'rotated' }> {
  // 1. Authoritative fresh server token overrides everything
  if (rewardsToken) {
    try {
      await storeLocal(userId, rewardsToken);
    } catch {
      // The current session can still render a server-issued token.
    }
    return { token: rewardsToken, source: 'rewards' };
  }

  // 2. Check local secure storage fallback
  let local: string | null = null;
  try {
    local = await readLocal(userId);
  } catch {
    // Web privacy settings can disable SecureStore; rotate below instead.
  }
  if (local) return { token: local, source: 'local' };

  // 3. Request rotation fallback
  const replacement = await apiRotate();
  try {
    await storeLocal(userId, replacement.qrToken);
  } catch {
    // Keep the usable in-memory token even when persistence is unavailable.
  }
  return { token: replacement.qrToken, source: 'rotated' };
}
