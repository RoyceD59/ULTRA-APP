---
name: Stray text node from non-boolean JSX conditions
description: Why `{x && <JSX/>}` can render an invisible stray text node on web (warning) and hard-crash on native, and how to guard against it in uc-companion.
---

React Native's `{condition && <JSX/>}` idiom renders whatever `condition` evaluates to
when it's falsy. If `condition` is a non-boolean falsy value (`''`, `0`, `NaN`), that
value — not `false`/`null`/`undefined` — becomes a child of the surrounding `<View>`.
react-native-web only warns ("Unexpected text node: . A text node cannot be a child of
a `<View>`."); on iOS/Android the same pattern throws a hard runtime error.

**Why:** `isOnSale`-style booleans built from `&&` chains over raw API fields (e.g.
`product.salePrice && ...`) inherit the field's type when the chain short-circuits.
An empty-string `salePrice` (WooCommerce's "no sale" sentinel) makes the whole
expression `''`, which is invisible on web but not a real boolean.

**How to apply:** Coerce every non-boolean operand at the start of an `&&` chain that
feeds directly into `{cond && <JSX/>}` with `!!`. `components/ProductCard.tsx` already
does this correctly (see its inline comment); `app/product/[id].tsx`'s `isOnSale` was
missing the same `!!` and was the source of a real recurring stray-text-node bug (fixed
2026-08-27). When adding similar sale/conditional flags derived from string/number API
fields anywhere in uc-companion, follow the ProductCard pattern.
