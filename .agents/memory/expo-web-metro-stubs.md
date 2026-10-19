---
name: Expo web Metro stubs
description: Native-only modules that crash the web bundle on load and must be resolved to empty via metro.config.js resolver.
---

Modules that access native constants (e.g. `PermissionStatus.UNDETERMINED`) at module-load time will crash the entire web bundle because Metro bundles all routes eagerly for web even when Expo Router lazy-loads them on native.

**The rule:** any native-only Expo module imported at the top level of ANY route file must be stubbed on web.

**How to apply:** add entries to the `WEB_STUBS` Set in `artifacts/uc-companion/metro.config.js`:

```js
const WEB_STUBS = new Set([
  'react-native-maps',
  'expo-contacts',
  'expo-contacts/legacy',
  'expo-sms',
]);
resolver.resolveRequest = (ctx, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS.has(moduleName)) {
    return { type: 'empty' };
  }
  ...
};
```

**Why:** `expo-contacts/legacy` in `referral.tsx` called `Contacts.PermissionStatus.UNDETERMINED` at module scope; on web that enum is `undefined`, throwing `Cannot read properties of undefined (reading 'UNDETERMINED')` before any React tree renders. The same class of bug affects `react-native-maps` (already stubbed) and `expo-sms`.

Any new native-only module added to a route file must be added here if it accesses native constants at module scope.
