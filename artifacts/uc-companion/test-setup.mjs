/**
 * Loaded via `node --import ./test-setup.mjs` before tsx and the test runner.
 *
 * TSX_TSCONFIG_PATH (set in the test script) handles ESM imports in .mts
 * test files.  This file patches Module._resolveFilename so that CJS
 * require() calls inside tsx-compiled .ts modules (e.g. useNotifications.ts,
 * which has no "type":"module" and is therefore loaded as CommonJS) also land
 * on the same lightweight stubs in __mocks__/.
 *
 * Because both paths resolve to the same absolute file, Node's CJS module
 * cache returns the same instance for both ESM and CJS callers, giving the
 * test the shared _scheduled / _storage state it reads back after calling
 * syncActivationWithCatalogue.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const _require = createRequire(import.meta.url);
const Module   = _require('module');
const root     = path.dirname(fileURLToPath(import.meta.url));
const mocks    = path.join(root, '__mocks__');

const STUBS = {
  'react':
    path.join(mocks, 'react.ts'),
  'react/jsx-runtime':
    path.join(mocks, 'react-jsx-runtime.ts'),
  'react-native':
    path.join(mocks, 'react-native.ts'),
  'expo-notifications':
    path.join(mocks, 'expo-notifications.ts'),
  'expo-constants':
    path.join(mocks, 'expo-constants.ts'),
  '@react-native-async-storage/async-storage':
    path.join(mocks, '@react-native-async-storage', 'async-storage.ts'),
  'expo-file-system':
    path.join(mocks, 'expo-file-system.ts'),
};

const original = Module._resolveFilename.bind(Module);
Module._resolveFilename = (request, parent, isMain, options) => {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) {
    return STUBS[request];
  }
  // Expo "@/..." path alias (tsconfig paths) — map to the project root and
  // retry with TypeScript extensions, mirroring Metro's resolution.
  if (request.startsWith('@/')) {
    const base = path.join(root, request.slice(2));
    for (const ext of ['.ts', '.tsx', '.mts', '']) {
      if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
    }
  }
  try {
    return original(request, parent, isMain, options);
  } catch (err) {
    // This hook is registered before tsx, so `original` is Node's built-in
    // resolver, which cannot resolve extensionless relative requires of .ts/
    // .tsx files emitted by tsx-compiled CJS modules (e.g. CartContext.tsx
    // requiring './cartStorage').  Retry with TypeScript extensions.
    if (request.startsWith('.') && parent?.filename) {
      const base = path.resolve(path.dirname(parent.filename), request);
      for (const ext of ['.ts', '.tsx', '.mts']) {
        if (fs.existsSync(base + ext)) return base + ext;
      }
    }
    throw err;
  }
};
