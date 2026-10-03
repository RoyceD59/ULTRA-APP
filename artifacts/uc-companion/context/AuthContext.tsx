import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { registerCurrentPushToken, unregisterPushToken } from '@/hooks/useNotifications';
import { authErrorMessage, companionLoginError } from '@/hooks/rateLimitAlert';
import { setRejectedSessionHandler } from '@/hooks/deletedAccountResponse';
import {
  clearPersistedSession,
  loadPersistedSession,
  persistSession,
  type PersistedSession,
} from '@/lib/sessionPersistence';
import { getApiBase } from '@/lib/apiBase';
import { completeUcTemporaryPasswordChange } from '@workspace/api-client-react';
import { useHydrationReminder } from '@/hooks/useHydrationReminder';
import { reconcileHydrationReminder } from '@/lib/hydrationReminder';

export interface UCUser {
  id: number;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  address?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  mustChangePassword?: boolean;
  temporaryPasswordExpiresAt?: string | null;
  token: string;
}

interface AuthContextValue {
  user: UCUser | null;
  token: string | null;
  /** One-time, user-safe explanation for an API-forced sign-out. */
  sessionNotice: string | null;
  dismissSessionNotice: () => void;
  /** True while an operator-issued temporary password must be replaced. */
  mustChangePassword: boolean;
  /** Expiry timestamp supplied by the Companion login contract. */
  temporaryPasswordExpiresAt: string | null;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<{ success: boolean; error?: string; requiresPasswordChange?: boolean }>;
  /** Replace a temporary password and atomically activate the permanent session. */
  changePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string; hint?: string }>;
  /** Exchange a verified Clerk session token (Google/Apple sign-in) for the app's own session. */
  socialLogin: (clerkToken: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  /** Clear the current app session when the API rejects its exact token. */
  handleRejectedSession: (rejectedToken?: string) => Promise<void>;
  /** Persist updated user fields locally so the UI reflects profile changes immediately. */
  updateUser: (updates: Partial<Pick<UCUser, 'firstName' | 'lastName' | 'phone' | 'address'>>) => Promise<void>;
}

interface RegisterData {
  email: string;
  phone: string;
  password: string;
  firstName: string;
  lastName: string;
  referralCode?: string;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  sessionNotice: null,
  dismissSessionNotice: () => {},
  mustChangePassword: false,
  temporaryPasswordExpiresAt: null,
  isLoading: true,
  login: async () => ({ success: false }),
  changePassword: async () => ({ success: false }),
  register: async () => ({ success: false }),
  socialLogin: async () => ({ success: false }),
  logout: async () => {},
  handleRejectedSession: async () => {},
  updateUser: async () => {},
});

function temporaryPasswordExpired(user: Pick<UCUser, 'mustChangePassword' | 'temporaryPasswordExpiresAt'>): boolean {
  if (!user.mustChangePassword) return false;
  if (!user.temporaryPasswordExpiresAt) return true;
  const expiresAt = Date.parse(user.temporaryPasswordExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

/**
 * Fire-and-forget: register the *current* Expo push token server-side.
 * Serialized with the foreground sync (usePushTokenSync), so a login-time
 * registration can never race it and overwrite a fresher token. Forced so a
 * different user logging in on the same device re-associates the token.
 */
async function registerPushTokenWithServer(authToken: string): Promise<void> {
  try {
    await registerCurrentPushToken(authToken, { allowPrompt: true, force: true });
  } catch {
    // Non-critical — silently ignore failures
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<UCUser | null>(null);
  const [token, setToken]     = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useHydrationReminder(user?.id ?? null, isLoading);
  const tokenRef = useRef<string | null>(token);
  const sessionVersion = useRef(0);
  const durableWrite = useRef<Promise<void>>(Promise.resolve());
  tokenRef.current = token;

  const enqueueDurableWrite = useCallback((work: () => Promise<void>): Promise<void> => {
    const next = durableWrite.current.then(work, work);
    durableWrite.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { session, malformed } = await loadPersistedSession();
        if (session && sessionVersion.current === 0) {
          const hydratedUser = session.user as unknown as UCUser;
          if (temporaryPasswordExpired(hydratedUser)) {
            // The backend rejects expired temporary sessions. Remove them before
            // rendering so a stale bearer can never reach a customer screen.
            const hydrationVersion = sessionVersion.current;
            await enqueueDurableWrite(async () => {
              if (sessionVersion.current === hydrationVersion) await clearPersistedSession();
            });
          } else {
            setToken(session.token);
            setUser(hydratedUser);
            // Re-register push token on every cold start (token may have rotated)
            registerPushTokenWithServer(session.token);
          }
        } else if (malformed && sessionVersion.current === 0) {
          const hydrationVersion = sessionVersion.current;
          await enqueueDurableWrite(async () => {
            // A login/logout may have started while storage was being read.
            // Never let malformed-startup cleanup remove that newer session.
            if (sessionVersion.current === hydrationVersion) {
              await clearPersistedSession();
            }
          });
        }
      } catch {}
      setIsLoading(false);
    })();
  }, [enqueueDurableWrite]);

  const activateSession = useCallback(async (
    operation: number,
    session: PersistedSession,
  ): Promise<boolean> => {
    await enqueueDurableWrite(async () => {
      // A slower response from an older login must not overwrite a newer one.
      if (sessionVersion.current !== operation) return;
      await persistSession(session);
    });
    if (sessionVersion.current !== operation) return false;
    setToken(session.token);
    setUser(session.user as unknown as UCUser);
    setSessionNotice(null);
    registerPushTokenWithServer(session.token);
    return true;
  }, [enqueueDurableWrite]);

  const login = async (identifier: string, password: string) => {
    const operation = ++sessionVersion.current;
    try {
      const res = await fetch(`${getApiBase()}/api/uc/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The endpoint accepts either an email address or a phone number and
        // performs canonical phone lookup server-side. Keeping the identifier
        // opaque here also preserves local-number input for server normalization.
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json() as { token?: string; user?: UCUser; error?: string };
      // Do not disclose whether an email/phone exists. Keep the rate-limit
      // response actionable, but use one neutral message for other failures.
      const loginErr = companionLoginError(res.status, res.ok, data.error);
      if (loginErr) return { success: false, error: loginErr };
      if (!data.token || !data.user) return { success: false, error: 'Login failed' };
      if (temporaryPasswordExpired(data.user)) {
        return { success: false, error: 'This temporary password has expired. Request a new one.' };
      }
      const committed = await activateSession(operation, { token: data.token, user: data.user as unknown as PersistedSession['user'] });
      if (!committed) return { success: false, error: 'Sign-in superseded by a newer request' };
      return data.user.mustChangePassword === true
        ? { success: true, requiresPasswordChange: true }
        : { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  };

  const changePassword = async (newPassword: string) => {
    const operation = sessionVersion.current;
    const activeToken = tokenRef.current;
    const currentUser = user;
    if (!activeToken || !currentUser?.mustChangePassword) {
      return { success: false, error: 'A temporary password session is required.' };
    }
    if (temporaryPasswordExpired(currentUser)) {
      await handleRejectedSession(activeToken);
      return { success: false, error: 'This temporary password has expired. Request a new one.' };
    }
    try {
      // Pass the current UC bearer explicitly. Clerk tokens are intentionally
      // never used for this app-owned password contract.
      const result = await completeUcTemporaryPasswordChange(
        { newPassword },
        { headers: { Authorization: `Bearer ${activeToken}` } },
      );
      if (
        sessionVersion.current !== operation
        || tokenRef.current !== activeToken
        || !result?.token
        || !result.user
        || result.user.mustChangePassword
      ) {
        return { success: false, error: 'Password change superseded by a newer request' };
      }
      // The endpoint intentionally returns a fresh permanent bearer. Merge
      // its narrow generated profile with the hydrated profile, then use the
      // same guarded activation path as login/register.
      const permanentUser: UCUser = {
        ...currentUser,
        ...result.user,
        mustChangePassword: false,
        temporaryPasswordExpiresAt: null,
      };
      const committed = await activateSession(operation, {
        token: result.token,
        user: permanentUser as unknown as PersistedSession['user'],
      });
      if (!committed) return { success: false, error: 'Password change superseded by a newer request' };
      return { success: true };
    } catch (error) {
      const responseData = (error as { data?: { error?: unknown } }).data;
      const message = typeof responseData?.error === 'string'
        ? responseData.error
        : 'Unable to change password';
      return { success: false, error: message };
    }
  };

  const register = async (d: RegisterData) => {
    const operation = ++sessionVersion.current;
    try {
      const res = await fetch(`${getApiBase()}/api/uc/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      const data = await res.json() as { token?: string; user?: UCUser; error?: string; hint?: string };
      const registerErr = authErrorMessage(res.status, res.ok, data.error, 'Registration failed');
      if (registerErr) return { success: false, error: registerErr, hint: data.hint };
      if (!data.token || !data.user) return { success: false, error: 'Registration failed', hint: data.hint };
      const committed = await activateSession(operation, { token: data.token, user: data.user as unknown as PersistedSession['user'] });
      if (!committed) return { success: false, error: 'Sign-in superseded by a newer request', hint: data.hint };
      return { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  };

  const socialLogin = async (clerkToken: string) => {
    const operation = ++sessionVersion.current;
    try {
      const res = await fetch(`${getApiBase()}/api/uc/auth/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clerkToken}` },
      });
      const data = await res.json() as { token?: string; user?: UCUser; error?: string };
      const socialErr = authErrorMessage(res.status, res.ok, data.error, 'Sign-in failed');
      if (socialErr || !data.token || !data.user) {
        return { success: false, error: socialErr || 'Sign-in failed' };
      }
      const committed = await activateSession(operation, { token: data.token, user: data.user as unknown as PersistedSession['user'] });
      if (!committed) return { success: false, error: 'Sign-in superseded by a newer request' };
      return { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  };

  const logout = async () => {
    const operation = ++sessionVersion.current;
    void reconcileHydrationReminder(null).catch(() => {});
    // Fire-and-forget: unregister this device's push token server-side so
    // order-update pushes stop arriving after logout (shared/handed-over device).
    const tokenToUnregister = tokenRef.current;
    if (tokenToUnregister) unregisterPushToken(tokenToUnregister).catch(() => {});
    await enqueueDurableWrite(async () => {
      if (sessionVersion.current === operation) await clearPersistedSession();
    });
    if (sessionVersion.current === operation) {
      setToken(null);
      setUser(null);
    }
  };

  const handleRejectedSession = useCallback(async (rejectedToken?: string) => {
    // A slow response from an old request must not clear a newer login.
    if (rejectedToken && tokenRef.current !== rejectedToken) {
      return;
    }
    const operation = ++sessionVersion.current;
    setSessionNotice('Your session has expired. Please sign in again.');
    // Drop memory state first so mounted queries stop issuing authenticated
    // requests while durable credentials are being removed.
    setToken(null);
    setUser(null);
    return enqueueDurableWrite(async () => {
      if (sessionVersion.current === operation) await clearPersistedSession();
    });
  }, [enqueueDurableWrite]);

  useEffect(
    () => setRejectedSessionHandler(handleRejectedSession),
    [handleRejectedSession],
  );

  useEffect(() => {
    if (!user?.mustChangePassword || !user.temporaryPasswordExpiresAt) return;
    const delay = Date.parse(user.temporaryPasswordExpiresAt) - Date.now();
    const expiryTimer = setTimeout(() => {
      void handleRejectedSession(tokenRef.current ?? undefined);
    }, Math.max(0, delay));
    return () => clearTimeout(expiryTimer);
  }, [handleRejectedSession, user?.mustChangePassword, user?.temporaryPasswordExpiresAt]);

  const updateUser = async (updates: Partial<Pick<UCUser, 'firstName' | 'lastName' | 'phone' | 'address'>>) => {
    if (!user) return;
    const operation = sessionVersion.current;
    const updated: UCUser = { ...user, ...updates };
    const activeToken = tokenRef.current;
    if (!activeToken) return;
    await enqueueDurableWrite(async () => {
      if (sessionVersion.current !== operation || tokenRef.current !== activeToken) return;
      await persistSession({ token: activeToken, user: updated as unknown as PersistedSession['user'] });
    });
    if (sessionVersion.current === operation && tokenRef.current === activeToken) {
      setUser(updated);
    }
  };

  const mustChangePassword = user?.mustChangePassword === true;
  const temporaryPasswordExpiresAt = user?.temporaryPasswordExpiresAt ?? null;
  const dismissSessionNotice = useCallback(() => setSessionNotice(null), []);

  return (
    <AuthContext.Provider value={{
      user,
      token,
      sessionNotice,
      dismissSessionNotice,
      mustChangePassword,
      temporaryPasswordExpiresAt,
      isLoading,
      login,
      changePassword,
      register,
      socialLogin,
      logout,
      handleRejectedSession,
      updateUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
