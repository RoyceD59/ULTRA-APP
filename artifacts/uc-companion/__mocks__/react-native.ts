/** Minimal react-native stub for the Node.js test runner. */
export const Platform: { OS: 'ios' | 'android' | 'web' } = { OS: 'ios' };
export const Alert    = { alert: () => {} };
export const Share = { share: async () => ({}) };
export const PixelRatio = { get: () => 1 };
export const Text = 'Text';
export const TouchableOpacity = 'TouchableOpacity';
export const View = 'View';
export const Modal = 'Modal';
export const ScrollView = 'ScrollView';
export const TextInput = 'TextInput';
export const KeyboardAvoidingView = 'KeyboardAvoidingView';
export const Switch = 'Switch';
export const ActivityIndicator = 'ActivityIndicator';
export const Linking = { openURL: async (_url: string): Promise<void> => {} };
let colorScheme: 'light' | 'dark' = 'light';
export function __setColorScheme(next: 'light' | 'dark'): void {
  colorScheme = next;
}
export function useColorScheme(): 'light' | 'dark' {
  return colorScheme;
}
export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
};

// ── Controllable AppState mock ────────────────────────────────────────────────
// Tests drive foreground/background transitions via __setAppState() and can
// inspect how many listeners remain subscribed via __appStateListenerCount().

export type AppStateStatus = 'active' | 'background' | 'inactive';

type Listener = (s: AppStateStatus) => void;
const listeners = new Set<Listener>();

export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener: (_type: string, handler: Listener) => {
    listeners.add(handler);
    return { remove: () => { listeners.delete(handler); } };
  },
};

/** Test helper: set the app state and notify all subscribed listeners. */
export function __setAppState(next: AppStateStatus): void {
  AppState.currentState = next;
  for (const l of [...listeners]) l(next);
}

/** Test helper: number of currently subscribed AppState listeners. */
export function __appStateListenerCount(): number {
  return listeners.size;
}

/** Test helper: reset AppState mock between tests. */
export function __resetAppState(): void {
  listeners.clear();
  AppState.currentState = 'active';
}

export function __setPlatform(next: 'ios' | 'android' | 'web'): void {
  Platform.OS = next;
}
