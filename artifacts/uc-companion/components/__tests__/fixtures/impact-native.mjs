// Plain ESM avoids CJS named-export inference in the component test loader.
// Child animations are not expanded by the element-tree harness.
export const Animated = {};
export const Easing = {};
export const ActivityIndicator = 'ActivityIndicator';
export const View = 'View';
export const Text = 'Text';
export const TouchableOpacity = 'TouchableOpacity';
export const StyleSheet = { create: styles => styles };
export const Linking = { openURL: async () => {} };
let state;
export function configure(value) { state = value; }
export function useGlobalImpact() { return state; }
export function useColors() { return { primary: '#005d8f', destructive: '#c00' }; }