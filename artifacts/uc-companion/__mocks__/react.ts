/**
 * Minimal React stub for the Node.js test runner.
 *
 * Implements just enough of React's hook semantics to render CartContext's
 * <CartProvider> as a plain function and drive it deterministically:
 *
 *   - useState:   setState calls QUEUE updaters; they are applied only on the
 *                 next render, with functional updaters receiving the latest
 *                 pending value (exactly React's batching semantics).  This is
 *                 the part that makes a stale-closure regression observable:
 *                 code that computes the next state from the render-time
 *                 variable instead of the `prev` argument will drop updates
 *                 issued between renders.
 *   - useCallback / useMemo: dependency-compared caching, like React, so a
 *                 callback captured from render N really does close over the
 *                 render-N state.
 *   - useEffect:  runs after render when deps change.
 *   - createContext / jsx: elements are plain {type, props} objects; the test
 *                 harness reads the Provider's `value` prop directly.
 *
 * The `__testRender` helper is the entry point for tests.
 */

export type ReactNode = unknown;

interface Hook {
  kind: 'state' | 'memo' | 'effect';
  state?: unknown;
  queue?: unknown[];
  deps?: unknown[] | undefined;
  value?: unknown;
}

interface Instance {
  hooks: Hook[];
  cursor: number;
  needsRender: boolean;
  pendingEffects: (() => void)[];
}

let current: Instance | null = null;

function inst(): Instance {
  if (!current) throw new Error('Hook called outside of __testRender');
  return current;
}

function getHook(kind: Hook['kind']): { hook: Hook; first: boolean } {
  const i = inst();
  const first = i.cursor >= i.hooks.length;
  if (first) i.hooks.push({ kind });
  const hook = i.hooks[i.cursor++];
  if (hook.kind !== kind) throw new Error('Hook order changed between renders');
  return { hook, first };
}

function depsEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (!a || !b) return false;
  return a.length === b.length && a.every((v, idx) => Object.is(v, b[idx]));
}

export function useState<S>(initial: S | (() => S)): [S, (u: S | ((prev: S) => S)) => void] {
  const i = inst();
  const { hook, first } = getHook('state');
  if (first) {
    hook.state = typeof initial === 'function' ? (initial as () => S)() : initial;
    hook.queue = [];
  }
  const setState = (u: S | ((prev: S) => S)) => {
    hook.queue!.push(u);
    i.needsRender = true;
  };
  return [hook.state as S, setState];
}

export function useCallback<T>(fn: T, deps: unknown[]): T {
  const { hook, first } = getHook('memo');
  if (first || !depsEqual(hook.deps, deps)) {
    hook.value = fn;
    hook.deps = deps;
  }
  return hook.value as T;
}

export function useMemo<T>(factory: () => T, deps: unknown[]): T {
  const { hook, first } = getHook('memo');
  if (first || !depsEqual(hook.deps, deps)) {
    hook.value = factory();
    hook.deps = deps;
  }
  return hook.value as T;
}

export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
  const i = inst();
  const { hook, first } = getHook('effect');
  if (first || !depsEqual(hook.deps, deps)) {
    hook.deps = deps;
    i.pendingEffects.push(() => { effect(); });
  }
}

export interface Context<T> { _def: T; Provider: (props: { value: T; children?: unknown }) => unknown }

export function createContext<T>(def: T): Context<T> {
  const ctx: Context<T> = {
    _def: def,
    Provider: (props) => props.children,
  };
  return ctx;
}

export function useContext<T>(ctx: Context<T>): T {
  return ctx._def;
}

// ── Test harness ─────────────────────────────────────────────────────────────

export interface TestRoot<P, V> {
  /** Provider `value` prop from the most recent render. */
  readonly value: V;
  /** Apply all queued state updates + effects until stable. */
  flush(): void;
  /** Number of renders performed so far. */
  readonly renderCount: number;
}

export function __testRender<P, V = any>(Component: (props: P) => any, props: P): TestRoot<P, V> {
  const instance: Instance = { hooks: [], cursor: 0, needsRender: false, pendingEffects: [] };
  let lastElement: any = null;
  let renders = 0;

  function renderOnce() {
    // Apply queued state updates in order (React batching semantics).
    for (const hook of instance.hooks) {
      if (hook.kind !== 'state') continue;
      for (const u of hook.queue!) {
        hook.state = typeof u === 'function' ? (u as (p: unknown) => unknown)(hook.state) : u;
      }
      hook.queue = [];
    }
    instance.needsRender = false;
    instance.cursor = 0;
    instance.pendingEffects = [];
    current = instance;
    try {
      lastElement = Component(props);
    } finally {
      current = null;
    }
    renders++;
    for (const eff of instance.pendingEffects) eff();
    instance.pendingEffects = [];
  }

  renderOnce();

  return {
    get value() {
      return lastElement?.props?.value as V;
    },
    flush() {
      let guard = 0;
      while (instance.needsRender) {
        if (++guard > 100) throw new Error('render loop did not stabilise');
        renderOnce();
      }
    },
    get renderCount() {
      return renders;
    },
  };
}

export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  return { type, props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children } };
}

const React = {
  useState, useCallback, useMemo, useEffect, createContext, useContext, createElement, __testRender,
};

export default React;
