import { Platform } from 'react-native';

/** Native heading role plus an explicit heading level for React Native Web. */
export function headingProps(level: 1 | 2 | 3) {
  return {
    accessibilityRole: 'header' as const,
    ...(Platform.OS === 'web' ? { 'aria-level': level } : {}),
  };
}