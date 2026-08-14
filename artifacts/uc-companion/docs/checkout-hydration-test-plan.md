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

## Pass criteria

- No frame ever shows $0.00 / empty line items before hydration completes.
- The spinner never persists after hydration (success or failure).
