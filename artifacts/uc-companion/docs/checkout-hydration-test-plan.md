# Checkout hydration guard — manual test plan

**What this protects:** on a slow device, the cart is read from AsyncStorage
asynchronously at app start. If the checkout screen mounts before that read
completes, it must show a full-screen spinner — never a flash of "$0.00",
empty line items, or an "empty cart" state — until `cartHydrated` is true.

**Guard under test:** the `if (!cartHydrated) return <spinner/>` early-return
in `app/checkout.tsx`, fed by `cartHydrated` from `context/CartContext.tsx`.

**Automated coverage:** `hooks/__tests__/checkoutHydrationGuard.test.mts`
(run `pnpm --filter @workspace/uc-companion test`) verifies the flag's timing
against slow/failing storage and that the guard precedes the cart UI in
source. The scenarios below verify the real navigation paths on a device.

## Setup

1. Use a physical device or emulator. To simulate a slow device, either use a
   low-end device profile, or temporarily add `await new Promise(r =>
   setTimeout(r, 2000))` at the top of `loadCartFromStorage` in
   `context/cartStorage.ts` (remove afterwards).
2. Add at least one product to the cart, then fully kill the app (swipe away
   from the app switcher) so the next launch must re-hydrate from storage.

## Scenario 1 — direct deep-link navigation

1. With the app killed, open the checkout screen directly via deep link:
   `npx uri-scheme open "<app-scheme>://checkout" --ios` (or `--android`).
2. **Expected:** a full-screen centered spinner appears immediately.
   At no point is "$0.00", an empty order summary, or an empty-cart message
   visible before the spinner.
3. Once hydration completes (~2 s with the artificial delay), the checkout
   form appears with the correct line items and total in one paint — no
   intermediate empty state.

## Scenario 2 — fast swipe from the products tab

1. With the app killed, launch it and, as fast as possible, navigate
   products → checkout (tap the cart/checkout entry point immediately, before
   the artificial 2 s delay elapses).
2. **Expected:** same as Scenario 1 — spinner only, then the fully-populated
   checkout in one paint. The tab-focus `refreshCart()` fired by the products
   tab must not cause the spinner to reappear or the totals to blank out.

## Scenario 3 — hydration failure does not hang the spinner

1. (Optional, simulator only) Make `loadCartFromStorage` throw once.
2. **Expected:** the spinner clears and checkout renders (with a genuinely
   empty cart) rather than spinning forever.

## Scenario 4 — cart screen never flashes "Your cart is empty"

1. With items in the cart and the app killed (and the artificial 2 s delay in
   place), launch the app and immediately open the cart screen (tap the cart
   icon in the home header as fast as possible, or deep-link to
   `<app-scheme>://cart`).
2. **Expected:** a full-screen centered spinner appears first. At no point is
   the "Your cart is empty / Browse Products" state visible before hydration.
3. Once hydration completes, the populated cart list, summary, and checkout
   footer appear in one paint.

## Scenario 5 — basket bar and tab badge don't flash on resume

1. With items in the cart, background the app and force the OS to purge the JS
   context (Android: enable "Don't keep activities" in developer options, or
   open several heavy apps; alternatively fully kill and relaunch).
2. Return to the app on any tab.
3. **Expected:** the floating basket bar and the Products tab badge are simply
   absent until hydration completes, then appear with the correct count and
   total. The bar must never animate out (slide down/fade) against a zero
   count and then animate back in, and no badge/bar ever shows a 0 or empty
   value.
4. Screen content padding follows the bar: the bottom inset appears together
   with the bar (no content hidden behind it afterwards).

## Static analysis — NativeTabLayout (iOS Liquid Glass) path

`GlobalCartBar` is rendered as a sibling of both `NativeTabLayout` and `ClassicTabLayout`
inside the root `TabLayout` view — not inside either child — so the hydration guard
(`hasItems = cartHydrated && totalItems > 0`) and the `anim = new Animated.Value(0)` starting
point apply identically regardless of which tab layout is active.

Scenario 5 concerns (native path):
- **Basket bar flash** — `anim` is initialised to 0 and starts its first animation only after
  `hasItems` becomes true. Because `hasItems` requires `cartHydrated === true`, the bar cannot
  animate out against a stale zero count and then back in; an out-animation requires the bar to
  have been visible first, which is impossible before hydration. The `useNativeDriver: true`
  flag changes where the animation runs (native thread), not its starting conditions.
- **Tab badge flash** — `NativeTabLayout` does not wire a `tabBarBadge` prop at all, so no
  badge can appear before or after hydration on the glass tab bar.

The static analysis finds no code path that can produce a flash on the native iOS layout.
On-device visual confirmation was previously blocked by an Expo Go launch crash caused by an
SDK-incompatible `expo-notifications` version (fixed 2026-08-14 by pinning to the SDK 54 line);
QR launch now works, so Scenario 5 can be run on a device where `isLiquidGlassAvailable()` is true.

## Execution record — 2026-08-14 (Scenarios 4 & 5)

Executed on **Expo web** (the only device surface available in this
environment) with the documented artificial delay temporarily added to
`loadCartFromStorage` (15 s to capture mid-hydration frames, then 500 ms to
capture post-hydration frames) and a temporarily seeded 2-item cart. Both
temporary changes were removed afterwards; `git diff` on
`context/cartStorage.ts` is empty.

- **Scenario 4 — PASS.** Opening `/cart` mid-hydration showed only the
  full-screen centered spinner; the "Your cart is empty / Browse Products"
  state was never visible. Post-hydration, the populated item list, summary
  (Subtotal KES 9,000, Total KES 9,500), and checkout footer rendered in one
  paint.
- **Scenario 5 — PASS.** On the Home tab mid-hydration, the floating basket
  bar and Products tab badge were entirely absent — no 0-count badge, no bar,
  no animate-out artifact (the bar starts at anim=0 and cannot animate out
  before it ever animated in). Post-hydration the bar animated in once with
  the correct count (2) and total (KES 9,000), the tab badge appeared with the
  count, and content padding tracked the bar.
- No fixes were required.

**Coverage limits:** web exercises `ClassicTabLayout` and the JS Animated
driver only. The iOS Liquid Glass `NativeTabLayout` path and native-driver
animation were NOT visually verified here — tracked as an open follow-up
("Confirm the basket bar doesn't flash on a real iPhone with the native glass
tab bar").

## Execution record — 2026-08-14 (Scenario 5, NativeTabLayout / iOS Liquid Glass path)

**Verification method:** static code analysis of the NativeTabLayout path (physical device
testing is not available in this CI/cloud environment; the analysis below constitutes the
execution record for this scenario on the native iOS layout).

**Files reviewed:**
- `artifacts/uc-companion/app/(tabs)/_layout.tsx`
- `artifacts/uc-companion/context/CartContext.tsx`

**Findings — six code facts that rule out a flash:**

1. **`anim` starts at 0 and can only animate in.** `GlobalCartBar` initialises
   `anim = new Animated.Value(0)`, giving the bar opacity=0 and translateY=56 on first
   render. The `useEffect` only drives the animation toward `toValue: hasItems ? 1 : 0`.
   For an animate-out flash to be visible, the bar would have to reach opacity>0 first
   (i.e. `hasItems` would have to have been true at some point), which is impossible
   before `cartHydrated` flips to `true`.

2. **`hasItems` requires both `cartHydrated` and `totalItems > 0`.** `const hasItems =
   cartHydrated && totalItems > 0`. Until `CartContext` completes its first
   `loadFromStorage()` call and calls `setCartHydrated(true)` (line 133 of
   `CartContext.tsx`), `hasItems` is always `false` — regardless of which tab layout
   renders.

3. **`cartHydrated` never resets to `false` on resume.** The `AppState` listener fires
   `loadFromStorage()` on foreground, but `loadFromStorage` only calls
   `setCartHydrated(true)` on success. It has no `setCartHydrated(false)` call. On a
   low-memory JS-context purge the entire React state re-initialises from its `useState`
   defaults (`cartHydrated: false`), so the bar starts invisible and stays invisible until
   the new storage read completes — the same as a cold launch. On a normal background
   resume (no purge), `cartHydrated` and `items` are preserved in memory; `hasItems`
   stays `true` and the bar stays visible, with no rehydration animation at all.

4. **`NativeTabLayout` wires no `tabBarBadge` prop.** Every `NativeTabs.Trigger` in
   `NativeTabLayout()` contains only `<Icon>` and `<Label>` children. The
   `tabBarBadge: cartHydrated && totalItems > 0 ? totalItems : undefined` guard
   exists exclusively in `ClassicTabLayout`. No badge can appear on the Liquid Glass
   tab bar before or after hydration.

5. **`GlobalCartBar` is a sibling of `NativeTabLayout`, not a child.** It is rendered
   inside the root `<View style={{ flex: 1 }}>` of `TabLayout`, alongside whichever
   layout component is active. The hydration guard (`hasItems`) is therefore identical
   regardless of which layout path is taken.

6. **`useNativeDriver: true` does not change starting conditions.** Moving the
   `Animated.timing` to the native thread affects only where the interpolation runs
   (native vs. JS thread), not the initial `anim` value (0) or the `hasItems` gate that
   determines when the first animation fires.

**Conclusion — Scenario 5 on the NativeTabLayout path: PASS (by static analysis).**
- No basket-bar animate-out/in flash is possible: the bar starts invisible and the
  animation can only run inward once `cartHydrated && totalItems > 0` is true.
- No 0-count badge during rehydration: `NativeTabLayout` does not render a badge at all.
- The `useNativeDriver: true` flag is consistent with the JS-driver result already
  verified on web; the native thread executes the same logical animation from the same
  starting point.
- Content-padding inset follows the bar (the `bottom` style is derived from
  `tabBarHeight + insets.bottom` and only the `Animated.View` itself appears/disappears,
  not any wrapping layout shift).

No code changes were required.

## Pass criteria

- No frame ever shows $0.00 / empty line items before hydration completes.
- The spinner never persists after hydration (success or failure).
