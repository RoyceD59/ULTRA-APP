import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The Companion credentials are one durable value. Keeping the bearer token
 * and its profile together prevents a cold start from hydrating half a
 * session, and gives logout/rejected-session cleanup one record to remove.
 */
export const AUTH_SESSION_KEY = 'uc_auth_session';
export const LEGACY_TOKEN_KEY = 'uc_auth_token';
export const LEGACY_USER_KEY = 'uc_auth_user';

export interface PersistedSessionProfile {
  id: number;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  address?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  /** Set for an operator-issued session until a permanent password is chosen. */
  mustChangePassword?: boolean;
  /** ISO timestamp at which the operator-issued password stops being usable. */
  temporaryPasswordExpiresAt?: string | null;
}

export interface PersistedSession {
  token: string;
  user: PersistedSessionProfile;
}

function validProfile(value: unknown): value is PersistedSessionProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  return Number.isSafeInteger(Number(profile.id))
    && Number(profile.id) > 0
    && typeof profile.email === 'string'
    // The API deliberately hides synthetic email addresses for phone-only
    // customers. Require a real contact, not an email specifically.
    && (profile.email.trim().length > 0
      || (typeof profile.phone === 'string' && profile.phone.trim().length > 0))
    && typeof profile.firstName === 'string'
    && typeof profile.lastName === 'string'
    && (profile.mustChangePassword === undefined || typeof profile.mustChangePassword === 'boolean')
    && (profile.temporaryPasswordExpiresAt === undefined
      || profile.temporaryPasswordExpiresAt === null
      || typeof profile.temporaryPasswordExpiresAt === 'string');
}

export function validSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return typeof session.token === 'string'
    && session.token.trim().length > 0
    && validProfile(session.user);
}

function parseSession(raw: string | null): PersistedSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Reads the combined record and migrates a complete legacy pair. A malformed
 * or partial record is explicitly reported so callers can remove it instead
 * of accidentally authenticating with stale credentials.
 */
export async function loadPersistedSession(): Promise<{
  session: PersistedSession | null;
  malformed: boolean;
}> {
  const [combined, legacyToken, legacyUser] = await Promise.all([
    AsyncStorage.getItem(AUTH_SESSION_KEY),
    AsyncStorage.getItem(LEGACY_TOKEN_KEY),
    AsyncStorage.getItem(LEGACY_USER_KEY),
  ]);

  if (combined !== null) {
    const session = parseSession(combined);
    return { session, malformed: !session };
  }

  let legacySession: PersistedSession | null = null;
  if (legacyToken && legacyUser) {
    try {
      legacySession = parseSession(JSON.stringify({ token: legacyToken, user: JSON.parse(legacyUser) }));
    } catch {
      legacySession = null;
    }
  }

  // JSON.parse above can throw for a malformed legacy profile.
  if (legacyToken && legacyUser && !legacySession) {
    return { session: null, malformed: true };
  }
  if (!legacyToken && !legacyUser) {
    return { session: null, malformed: false };
  }
  return { session: legacySession, malformed: !legacySession };
}

export async function persistSession(session: PersistedSession): Promise<void> {
  if (!validSession(session)) throw new Error('Cannot persist an invalid Companion session');
  await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  // Remove legacy values only after the complete replacement has been stored.
  await Promise.all([
    AsyncStorage.removeItem(LEGACY_TOKEN_KEY),
    AsyncStorage.removeItem(LEGACY_USER_KEY),
  ]);
}

export async function clearPersistedSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(AUTH_SESSION_KEY),
    AsyncStorage.removeItem(LEGACY_TOKEN_KEY),
    AsyncStorage.removeItem(LEGACY_USER_KEY),
  ]);
}