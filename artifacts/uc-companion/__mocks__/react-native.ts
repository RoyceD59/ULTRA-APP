/** Minimal react-native stub for the Node.js test runner. */
export const Platform = { OS: 'ios' as const };
export const Alert    = { alert: () => {} };
export const AppState = {
  addEventListener: (_type: string, _handler: (s: string) => void) => ({ remove: () => {} }),
};
