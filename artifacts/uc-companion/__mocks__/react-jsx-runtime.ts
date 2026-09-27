/**
 * react/jsx-runtime stub for the Node.js test runner.
 * JSX elements become plain { type, props } objects; the react.ts test
 * harness reads props off them directly (e.g. the Provider `value`).
 */

export function jsx(type: unknown, props: Record<string, unknown>, key?: unknown) {
  return { type, props, key };
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export const Fragment = Symbol.for('react.fragment');
