import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerCurrentPushToken } from '@/hooks/useNotifications';

export interface UCUser {
  id: number;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  token: string;
}

interface AuthContextValue {
  user: UCUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  /** Persist updated user fields locally so the UI reflects profile changes immediately. */
  updateUser: (updates: Partial<Pick<UCUser, 'firstName' | 'lastName' | 'phone'>>) => Promise<void>;
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
  isLoading: true,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => {},
  updateUser: async () => {},
});

const TOKEN_KEY = 'uc_auth_token';
const USER_KEY  = 'uc_auth_user';

const getBase = () =>
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : 'http://localhost:8080';

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
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
          // Re-register push token on every cold start (token may have rotated)
          registerPushTokenWithServer(storedToken);
        }
      } catch {}
      setIsLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await fetch(`${getBase()}/api/uc/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { token?: string; user?: UCUser; error?: string };
      if (res.status === 429) return { success: false, error: data.error || 'Too many attempts. Please wait a minute before trying again.' };
      if (!res.ok || data.error) return { success: false, error: data.error || 'Login failed' };
      const u = data.user!;
      await AsyncStorage.setItem(TOKEN_KEY, data.token!);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
      setToken(data.token!);
      setUser(u);
      // Register push token after successful login (fire-and-forget)
      registerPushTokenWithServer(data.token!);
      return { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  };

  const register = async (d: RegisterData) => {
    try {
      const res = await fetch(`${getBase()}/api/uc/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      const data = await res.json() as { token?: string; user?: UCUser; error?: string };
      if (res.status === 429) return { success: false, error: data.error || 'Too many attempts. Please wait a minute before trying again.' };
      if (!res.ok || data.error) return { success: false, error: data.error || 'Registration failed' };
      await AsyncStorage.setItem(TOKEN_KEY, data.token!);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user!));
      setToken(data.token!);
      setUser(data.user!);
      // Register push token after successful registration (fire-and-forget)
      registerPushTokenWithServer(data.token!);
      return { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  };

  const logout = async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  const updateUser = async (updates: Partial<Pick<UCUser, 'firstName' | 'lastName' | 'phone'>>) => {
    if (!user) return;
    const updated: UCUser = { ...user, ...updates };
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
    setUser(updated);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
