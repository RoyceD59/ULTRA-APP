/**
 * @react-native-async-storage/async-storage stub for the Node.js test runner.
 *
 * The `_storage` map and `_reset()` are exported so tests can pre-seed data
 * and clear state between runs.
 */

export const _storage: Map<string, string> = new Map();

/**
 * Optional per-operation gates so tests can defer / reorder storage I/O.
 * When set, each getItem/setItem awaits the gate before touching the map,
 * letting tests simulate slow or adversarially-ordered AsyncStorage.
 */
interface Gates {
  get?: () => Promise<void>;
  set?: () => Promise<void>;
}
let _gates: Gates = {};

export function _setGates(gates: Gates): void {
  _gates = gates;
}

export function _reset(): void {
  _storage.clear();
  _gates = {};
}

const AsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (_gates.get) await _gates.get();
    return _storage.get(key) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (_gates.set) await _gates.set();
    _storage.set(key, value);
  },
  removeItem: async (key: string): Promise<void>           => { _storage.delete(key); },
  clear:      async (): Promise<void>                      => { _storage.clear(); },
};

export default AsyncStorage;
