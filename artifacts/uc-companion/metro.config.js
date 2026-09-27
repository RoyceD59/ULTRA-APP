const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ── 1. Exclude react-native-maps from the web bundle ────────────────────────
// The .native.tsx / .tsx platform split keeps the import out of the web entry
// point, but Metro still resolves the full module graph eagerly.
const { resolver } = config;
const upstream = resolver.resolveRequest;
// Modules that are native-only and must be stubbed to empty on web.
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
  if (upstream) return upstream(ctx, moduleName, platform);
  return ctx.resolveRequest(ctx, moduleName, platform);
};

// ── 2. Block ephemeral pnpm staging directories from the Metro watcher ───────
// pnpm creates short-lived _tmp_NNNN directories during postinstall scripts
// (e.g. react-native-maps, @expo/image-utils) and removes them before Metro
// starts walking the file tree.  Metro then throws ENOENT trying to watch
// them.  The blockList prevents Metro from ever trying to index those paths.
//
// We also exclude the Android Gradle tree for react-native-maps — it is never
// needed when running through Expo Go / web.
const blockPatterns = [
  // Any package's pnpm _tmp_NNNN staging dir (covers all packages)
  /_tmp_\d+[/\\]/,
  // react-native-maps android build tree
  /react-native-maps[^/\\]*[/\\]android[/\\]/,
  // Node.js test doubles — kept in hooks/node_modules/ so the test runner and
  // the module-under-test share the same stub instance via nearest-node_modules
  // resolution.  Blocked here so Metro always falls through to the real
  // packages in the project-root node_modules/ and never ships stub code.
  /hooks[/\\]node_modules[/\\]/,
];

const existing = config.resolver.blockList;
if (existing) {
  const prev = Array.isArray(existing) ? existing : [existing];
  config.resolver.blockList = [...prev, ...blockPatterns];
} else {
  config.resolver.blockList = blockPatterns;
}

module.exports = config;
