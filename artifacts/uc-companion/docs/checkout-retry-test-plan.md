# Checkout Retry / COD Button Test Plan

**File under test:** `app/checkout.tsx`

---

## Bugs fixed

### 1 — Cancel while M-Pesa is waiting did not reset `processing`
The waiting-screen Cancel button called `setMpesaWaiting(false)` but left `processing = true`,
permanently disabling the checkout button.  
**Fix:** also call `setProcessing(false)` in the Cancel `onPress`.

### 2 — `pollRef.current` was never nulled after `clearInterval`
Every `clearInterval(pollRef.current!)` left the ref holding a stale timer handle.
Subsequent guards (`if (pollRef.current)`) would wrongly see a truthy (dead) value.  
**Fix:** assign `pollRef.current = null` immediately after every `clearInterval`.

### 3 — Stale poll callbacks from a cancelled/timed-out attempt could call `createOrder`
The previous component-wide boolean guard (`mpesaCancelledRef`) had a race: Cancel sets it
`true`, a new retry resets it `false`, then the old in-flight `mpesaStatus` response
resolves, sees `false`, and creates an order for the cancelled attempt.  The same race
existed after a timeout, which cleared the interval without invalidating in-flight requests.  
**Fix:** replaced with a per-attempt ID (`attemptRef`, a `useRef<number>`).
`handleMpesa` increments it and captures `thisAttempt` in closure scope at call time.
Every async step (before and after `await`) checks `attemptRef.current === thisAttempt`;
stale callbacks bail out silently. Cancel increments `attemptRef.current` directly,
invalidating the live attempt without touching the new one. A `settled` flag prevents two
near-simultaneous poll ticks from both reaching `createOrder` after an `await`.

---

## Implementation invariants

| Variable | After Cancel | After timeout/failed alert | After successful order |
|---|---|---|---|
| `processing` | `false` | `false` | `false` |
| `mpesaWaiting` | `false` | `false` | `false` |
| `attemptRef.current` | incremented (old attempt rejected) | unchanged | unchanged |
| `pollRef.current` | `null` | `null` | `null` |
| `showMpesaModal` | `false` (main screen) | `false` (main screen) | — (navigated away) |

---

## Scenarios to verify on a real device (or Expo Go)

### 1 — Stripe: server returns 500 on session creation

**Setup:** disable network or use a bad API key so `api.stripeSession` throws.

**Steps**
1. Select **Pay with Stripe Checkout**, tap Confirm.
2. Observe alert "Stripe Unavailable" with **Try again** / **Pay with COD instead**.
3. Verify confirm button is not spinning (`processing = false` before alert fires).

**Try again path**
- Tap **Try again** → `handleStripeCheckout()` re-runs; button shows spinner.
- Restore network → Stripe browser opens normally → order created on verify.

**COD path**
- Tap **Pay with COD instead** → picker shows COD; button reads "Place Order (COD)"; no spinner.

---

### 2 — M-Pesa: STK push returns 500

**Setup:** disable network so `api.mpesaSTKPush` throws.

**Steps**
1. Select M-Pesa, tap Confirm, enter phone, tap **Send Payment Request**.
2. Observe alert "M-Pesa Unavailable" (modal stays open underneath it — phone pre-filled).
3. `processing = false`; waiting screen never appears; `pollRef.current` is `null`.

**Try again path**
- Tap **Try again** → `handleMpesa()` re-runs with a new `thisAttempt`; processing goes `true`.
- Restore network → STK push succeeds → waiting screen appears.

**COD path**
- Tap **Pay with COD instead** → modal closes; picker switches to COD; no spinner.

---

### 3 — M-Pesa: poll times out (no PIN entered)

**Setup:** sandbox STK push succeeds; do not enter PIN; wait ~60 s (20 × 3 s).

**Steps**
1. Observe "M-Pesa Timed Out" alert with **Try again** / **Pay with COD instead**.
2. Verify: `processing = false`, `mpesaWaiting = false`, `pollRef.current = null`.

**Try again path**
- Tap **Try again** → M-Pesa modal re-opens (`setShowMpesaModal(true)`).
- Tap **Send Payment Request** → `handleMpesa()` fires with new `thisAttempt`; fresh STK push.

**COD path**
- Picker switches to COD; main checkout is fully interactive.

---

### 4 — M-Pesa: poll returns `status = "failed"`, `retriable = true`

Same as scenario 3 but the poll returns `{ status: 'failed', retriable: true }`.  
Expected behaviour and retry/COD paths identical to scenario 3.

---

### 5 — M-Pesa: poll returns `status = "failed"`, `retriable = false`

**Steps**
1. Poll returns `{ status: 'failed', retriable: false, resultDesc: '...' }`.
2. Alert "Payment Not Completed" with a single **OK** (no retry offered).
3. Safaricom-app hint is shown.
4. `processing = false`; `pollRef.current = null`; main checkout is interactive.

---

### 6 — Cancel while waiting for M-Pesa PIN

**Steps**
1. Trigger a successful STK push; waiting screen appears.
2. Tap **Cancel**.
3. Verify: poll interval cleared immediately; `pollRef.current = null`; `attemptRef` incremented.
4. Waiting screen disappears; confirm button is **not** greyed out / spinning.
5. User can tap confirm again or switch payment method.

**Late-response guard (key scenario)**
1. Cancel while an `api.mpesaStatus` call is already in-flight.
2. That response resolves after Cancel; callback sees `attemptRef.current !== thisAttempt`
   and returns without calling `createOrder` or touching UI state.
3. Immediately start a new attempt (tap Confirm → M-Pesa modal → Send Request).
4. New attempt runs to completion without interference from the stale callback.

---

### 7 — Full happy path after a prior retry

**Steps**
1. Induce scenario 2 (STK 500), tap **Try again**.
2. Restore network; let the STK push succeed; enter correct PIN.
3. Order is created; cart clears; app navigates to order confirmation.
4. No duplicate orders (each `handleMpesa` call generates a new `cart_<timestamp>` reference).
