import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Modal, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useRouter } from 'expo-router';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { useApi, UCAddress, ApiError, type PaymentsConfig, type CheckoutPromotionQuote } from '@/hooks/useApi';
import PaymentMethodPicker, { PaymentMethod } from '@/components/PaymentMethodPicker';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { classifyMpesaStatus, pollSettleClearsRef } from '@/hooks/mpesaStatusClassifier';
import { decideRetryGuard } from '@/hooks/mpesaRetryGuard';
import { cancelMpesaPoll, isCancelledAttempt } from '@/hooks/mpesaPollManager';
import { classifyPaymentInitError, RATE_LIMIT_TITLE, RATE_LIMIT_MESSAGE } from '@/hooks/rateLimitAlert';
import {
  retainCheckoutOrderIdentity,
  type CheckoutOrderIdentity,
} from '@/hooks/checkoutOrderIdentity';
import AlisonBubble from '@/components/AlisonBubble';
import { CountryPicker } from '@/components/CountryPicker';
import { normalizeInstantPhone, isValidInstantPhone } from '@workspace/api-zod/instant-water-identity';
import { countryCodeFromValue } from '@workspace/api-zod/phone';
import { trackEvent } from '@/lib/analytics';

const DELIVERY_FEE = 500;

/**
 * Build Alison's checkout greeting. Personal when the customer is signed in,
 * general otherwise; always mentions the cart contents and stays welcoming and
 * customer-focused. `seed` keeps the randomly chosen variant stable across
 * re-renders.
 */
function buildAlisonGreeting(
  firstName: string | undefined,
  cartItems: { name: string }[],
  seed: number,
): string {
  const openers = firstName?.trim()
    ? [`Hi ${firstName.trim()}!`, `Hello ${firstName.trim()}!`, `Welcome back, ${firstName.trim()}!`]
    : ['Hello!', 'Hi there!', 'Welcome!'];
  const opener = openers[Math.floor(seed * openers.length) % openers.length];
  const first = cartItems[0]?.name;
  const cartLine = first
    ? ` I see you have ${first}${cartItems.length > 1 ? ' and more' : ''} in your cart.`
    : '';
  return `${opener}${cartLine} I am here to help with replacement filters, payments or other needs.`;
}

const DEFAULT_ADDRESS: UCAddress = {
  firstName: '', lastName: '', address1: '', address2: '',
  city: 'Nairobi', country: 'KE', phone: '',
};

// ── Delivery-details validation ────────────────────────────────────────────
// Mirrors the server-side COD checks (api-server lib/order-validation.ts) so
// customers get instant, friendly feedback instead of a server rejection.

/** Keyboard-row runs that indicate mashing rather than a real name. */
const KEYBOARD_RUNS = [
  'qwer', 'wert', 'erty', 'rtyu', 'tyui', 'yuio', 'uiop',
  'asdf', 'sdfg', 'dfgh', 'fghj', 'ghjk', 'hjkl',
  'zxcv', 'xcvb', 'cvbn', 'vbnm',
];

function looksLikeRealName(raw: string): boolean {
  const name = raw.trim();
  if (name.length < 2 || name.length > 60) return false;
  if (!/^[\p{L}][\p{L}\s'’.-]*$/u.test(name)) return false;
  const plain = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (!/[aeiouy]/.test(plain)) return false;          // "hjkhjk" has no vowels
  if (/(.)\1\1/.test(plain)) return false;            // "aaaa" is mashing
  if (KEYBOARD_RUNS.some(run => plain.includes(run))) return false;
  return true;
}

type AddressErrors = Partial<Record<'firstName' | 'lastName' | 'address1' | 'city' | 'phone', string>>;

/**
 * Returns {} when the address is valid; field → message otherwise.
 *
 * `strict` (COD only) mirrors the server's cash-order policy: plausible
 * names, a dialable phone, plus last name and city. Verified-payment methods
 * (M-Pesa/Paystack/Stripe) keep the original presence-only checks — the
 * server deliberately does not gate paid orders on these heuristics, and the
 * client must not block a customer who is about to pay.
 */
function checkAddress(address: UCAddress, strict: boolean): AddressErrors {
  const errors: AddressErrors = {};
  if (!address.firstName.trim()) errors.firstName = 'First name is required.';
  else if (strict && !looksLikeRealName(address.firstName)) errors.firstName = 'Please enter your real first name.';
  if (strict) {
    if (!address.lastName.trim()) errors.lastName = 'Last name is required.';
    else if (!looksLikeRealName(address.lastName)) errors.lastName = 'Please enter your real last name.';
    if (!address.city.trim()) errors.city = 'City is required.';
  }
  if (!address.address1.trim()) errors.address1 = 'Delivery address is required.';
  if (!address.phone.trim()) errors.phone = 'Phone number is required.';
  else if (!isValidInstantPhone(address.phone, countryCodeFromValue(address.country) ?? 'KE')) errors.phone = 'Enter a valid phone number for the selected country.';
  return errors;
}

type AddressField = 'firstName' | 'lastName' | 'address1' | 'city' | 'phone';

interface FieldDef {
  label: string;
  key: AddressField;
  placeholder: string;
  keyboard?: 'default' | 'phone-pad';
}

const ADDRESS_FIELDS: FieldDef[] = [
  { label: 'First name', key: 'firstName', placeholder: 'Jane' },
  { label: 'Last name', key: 'lastName', placeholder: 'Doe' },
  { label: 'Address', key: 'address1', placeholder: 'Street address' },
  { label: 'City', key: 'city', placeholder: 'Nairobi' },
  { label: 'Phone', key: 'phone', placeholder: '+254700000000', keyboard: 'phone-pad' },
];

export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { items, totalPrice, clearCart, cartHydrated, cartLoadError, refreshCart } = useCart();
  const { user } = useAuth();
  const api = useApi();
  const checkoutStarted = useRef(false);

  useEffect(() => {
    if (!cartHydrated || items.length === 0 || checkoutStarted.current) return;
    checkoutStarted.current = true;
    trackEvent('checkout_started', {
      itemCount: items.reduce((count, item) => count + item.quantity, 0),
    });
  }, [cartHydrated, items]);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('paystack');
  // Server-driven method availability — hides deactivated providers (e.g. card
  // payments while Stripe is switched off). Null until fetched; on fetch failure
  // every method stays visible so checkout is never blocked by a config blip.
  const [paymentsConfig, setPaymentsConfig] = useState<PaymentsConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getPaymentsConfig()
      .then(cfg => {
        if (cancelled) return;
        setPaymentsConfig(cfg);
        // If the currently selected method was deactivated server-side, fall
        // back to the first available method so Confirm never hits a dead end.
        setPaymentMethod(prev => {
          if (cfg.methods[prev] !== false) return prev;
          const order: PaymentMethod[] = ['paystack', 'mpesa', 'cod', 'stripe'];
          return order.find(m => cfg.methods[m] !== false) ?? prev;
        });
      })
      .catch(() => { /* keep defaults — all methods visible */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [address, setAddress] = useState<UCAddress>({
    ...DEFAULT_ADDRESS,
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
  });
  // Field-level validation messages, shown under the offending input. An
  // entry is cleared as soon as the customer edits that field again.
  const [addressErrors, setAddressErrors] = useState<AddressErrors>({});
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [showMpesaModal, setShowMpesaModal] = useState(false);
  // `processing` is plain React state — it is NOT persisted across process
  // restarts.  If the user force-quits the app while processing is true (e.g.
  // during a Stripe browser open or a Paystack verify call), the OS tears down
  // the JS heap and useState(false) runs fresh on the next launch.  The checkout
  // button therefore cannot be stuck disabled after a force-quit.
  // See docs/checkout-retry-test-plan.md §§ 8-10 for the manual test checklist.
  const [processing, setProcessing] = useState(false);
  const [mpesaWaiting, setMpesaWaiting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Monotonically incrementing attempt counter.  Each call to handleMpesa captures
  // its own `thisAttempt` value in closure scope.  Every async step checks
  // `attemptRef.current === thisAttempt` before acting, so stale callbacks from a
  // prior attempt (cancelled, timed-out, or already settled) are silently discarded
  // regardless of when their in-flight network requests resolve.
  const attemptRef = useRef(0);
  // Persists the CheckoutRequestID of the most recent STK push across retries.
  // Before issuing a new push, handleMpesa queries this ID's status — if the
  // original push completed while the user was on the timeout screen, we create
  // the order from it instead of charging the customer a second time.
  const lastCheckoutRequestIdRef = useRef<string | null>(null);

  // Alison greeting — variant chosen once per checkout visit (stable seed)
  const greetingSeedRef = useRef(Math.random());
  const alisonGreeting = buildAlisonGreeting(user?.firstName, items, greetingSeedRef.current);

  // Promo / referral code
  const [promoInput, setPromoInput] = useState('');
  const [showPromoField, setShowPromoField] = useState(false);
  const [promoValidating, setPromoValidating] = useState(false);
  const [appliedQuote, setAppliedQuote] = useState<CheckoutPromotionQuote | null>(null);
  const [usingReferralDiscount, setUsingReferralDiscount] = useState(false);
  // A payment confirmation can retry order persistence; keep its key stable
  // until it succeeds so an intermittent connection cannot consume a promo twice.
  const orderIdentityRef = useRef<CheckoutOrderIdentity | null>(null);

  const grossTotal = totalPrice + DELIVERY_FEE;
  const total = appliedQuote?.total ?? grossTotal;

  function validateAddress(): boolean {
    const errors = checkAddress(address, paymentMethod === 'cod');
    setAddressErrors(errors);
    const first = Object.values(errors)[0];
    if (first) {
      Alert.alert('Check your delivery details', first);
      return false;
    }
    const normalizedPhone = normalizeInstantPhone(address.phone, countryCodeFromValue(address.country) ?? 'KE');
    if (normalizedPhone && normalizedPhone !== address.phone) {
      setAddress(prev => ({ ...prev, phone: normalizedPhone }));
    }
    return true;
  }

  async function handleConfirm() {
    if (!validateAddress()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (paymentMethod === 'mpesa') { setShowMpesaModal(true); return; }
    if (paymentMethod === 'stripe') { await handleStripeCheckout(); return; }
    if (paymentMethod === 'paystack') { await handlePaystack(); return; }
    if (paymentMethod === 'cod') { await createOrder('cod', 'COD'); }
  }

  /**
   * Poll Daraja for the status of an in-flight STK push identified by
   * `checkoutRequestId`.  This is a shared helper used both for a freshly
   * initiated push and for a resumed poll after "Try again" — keeping the
   * polling logic in one place prevents drift between the two paths.
   *
   * The function shows the waiting UI, runs up to 20 ticks (≈ 60 s), and:
   *   - success  → clears lastCheckoutRequestIdRef, creates the order
   *   - failed   → clears ref, shows the appropriate alert
   *   - timeout  → leaves ref intact so the next "Try again" can re-check
   *                the same push before issuing a new one
   *
   * Every async step is guarded by `thisAttempt === attemptRef.current` so
   * stale callbacks from a cancelled or superseded attempt are silently
   * discarded.
   */
  function startMpesaPoll(checkoutRequestId: string, thisAttempt: number) {
    setShowMpesaModal(false);
    setMpesaWaiting(true);
    let attempts = 0;
    // `settled` prevents two near-simultaneous ticks from both reaching
    // createOrder / clearInterval after an await.
    let settled = false;

    const intervalId = setInterval(async () => {
      // Discard if a newer attempt has started (cancel, retry, or timeout).
      if (isCancelledAttempt(thisAttempt, attemptRef)) { clearInterval(intervalId); return; }
      if (settled) return;
      attempts++;
      if (attempts > 20) {
        settled = true;
        clearInterval(intervalId);
        if (pollRef.current === intervalId) pollRef.current = null;
        setMpesaWaiting(false);
        setProcessing(false);
        // lastCheckoutRequestIdRef is intentionally NOT cleared here — the
        // push may still complete moments after the UI timeout.  Keeping the
        // ref means the next "Try again" will query it before sending a new
        // push, preventing a double charge.
        Alert.alert(
          'M-Pesa Timed Out',
          'M-Pesa confirmation timed out. You can try again or place your order with Cash on Delivery.',
          [
            { text: 'Try again', onPress: () => setShowMpesaModal(true) },
            {
              // Customer is switching away from M-Pesa — clear the stored ref
              // so a later return to M-Pesa doesn't query a stale push.
              text: 'Pay with COD instead',
              onPress: () => { lastCheckoutRequestIdRef.current = null; setPaymentMethod('cod'); },
              style: 'cancel',
            },
          ],
        );
        return;
      }
      try {
        const status = await api.mpesaStatus(checkoutRequestId);
        // Re-check after the await — cancel / new retry may have fired while
        // the network request was in-flight.
        if (isCancelledAttempt(thisAttempt, attemptRef)) return;
        if (settled) return;
        const action = classifyMpesaStatus(status);
        if (action.kind === 'create_order') {
          settled = true;
          clearInterval(intervalId);
          if (pollRef.current === intervalId) pollRef.current = null;
          // Do NOT clear the ref yet — only clear it after order creation
          // succeeds.  If createOrder fails (network error, server blip) and
          // the customer retries, the guard must still see this confirmed
          // payment and retry createOrder rather than issuing a new STK push.
          const orderCreated = await createOrder('mpesa', checkoutRequestId);
          if (orderCreated) lastCheckoutRequestIdRef.current = null;
        } else if (pollSettleClearsRef(action)) {
          settled = true;
          clearInterval(intervalId);
          if (pollRef.current === intervalId) pollRef.current = null;
          // Definitive failure — no point querying this ref again on retry.
          // pollSettleClearsRef encodes this rule (hint_dialog | retry_dialog)
          // as the single source of truth shared with the test suite.
          lastCheckoutRequestIdRef.current = null;
          setMpesaWaiting(false);
          setProcessing(false);
          if (action.kind === 'hint_dialog') {
            // retriable=false: wrong PIN, user cancelled, insufficient funds.
            // Show dismissal + Safaricom-app PIN hint (no retry buttons).
            Alert.alert(action.title, action.message);
          } else if (action.kind === 'retry_dialog') {
            // retriable=true: transient network/server error.
            // Offer "Try again / Pay with COD".
            Alert.alert(action.title, action.message, [
              { text: 'Try again', onPress: () => setShowMpesaModal(true) },
              {
                text: 'Pay with COD instead',
                onPress: () => setPaymentMethod('cod'),
                style: 'cancel',
              },
            ]);
          }
        }
        // action.kind === 'continue_polling' → keep the interval running
      } catch { /* transient network error — keep polling */ }
    }, 3000);
    pollRef.current = intervalId;
  }

  async function handleMpesa() {
    if (!mpesaPhone || mpesaPhone.length < 9) {
      Alert.alert('Invalid number', 'Enter a valid Safaricom number (e.g. 0712 345 678)');
      return;
    }
    // Stamp this attempt with a unique ID captured in closure scope.
    // Every async step checks thisAttempt === attemptRef.current before acting,
    // so if Cancel / timeout / a new retry increments the counter while a
    // network request is in-flight, the stale callback simply returns.
    const thisAttempt = ++attemptRef.current;
    setProcessing(true);

    // ── Double-charge guard ──────────────────────────────────────────────────
    // If a previous STK push was issued (e.g. the user hit "Try again" after
    // a timeout), query its status BEFORE sending a new push.
    //
    //   success → payment completed while the UI timed out; create the order
    //             from the original push — no new charge needed.
    //
    //   failed  → definitive decline; safe to clear the ref and send a fresh push.
    //
    //   pending → Daraja is still processing the original push; resuming the
    //             poll is the only safe option — sending a new push now could
    //             result in two charges if the original completes moments later.
    //
    //   network error → we cannot determine whether the original push is still
    //             live; the safest response is to resume polling it rather than
    //             risk a double charge.  If the original ultimately fails, the
    //             poll loop will clear the ref and the next retry will send a
    //             new push.
    const priorRef = lastCheckoutRequestIdRef.current;
    if (priorRef) {
      // ── Double-charge guard ────────────────────────────────────────────────
      // Query the prior push status, then let decideRetryGuard map it to one
      // of three actions:
      //   use_prior   → push confirmed paid; create order from it, no new push
      //   resume_poll → push still live (pending / network error); keep polling
      //   fresh_push  → push definitively failed; safe to send a new push
      let guardResult: Awaited<ReturnType<typeof api.mpesaStatus>> | null = null;
      let queryFailed = false;
      try {
        guardResult = await api.mpesaStatus(priorRef);
      } catch {
        queryFailed = true;
      }
      if (isCancelledAttempt(thisAttempt, attemptRef)) return; // cancelled while querying

      const guardAction = decideRetryGuard(
        priorRef,
        queryFailed || !guardResult
          ? { ok: false }
          : { ok: true, response: guardResult },
      );

      if (guardAction.kind === 'use_prior') {
        // Original push confirmed paid — create the order from it.
        // Do NOT clear the ref until createOrder succeeds: if order creation
        // fails (network blip) the ref must survive so the next retry
        // re-detects this confirmed payment and retries createOrder rather
        // than sending a new STK push.
        const orderCreated = await createOrder('mpesa', guardAction.priorRef);
        if (orderCreated) lastCheckoutRequestIdRef.current = null;
        else setProcessing(false);
        return;
      }

      if (guardAction.kind === 'resume_poll') {
        // Push still in-flight (pending or network error) — resume polling.
        // Do NOT issue a new STK push; the original may still succeed.
        startMpesaPoll(guardAction.priorRef, thisAttempt);
        return;
      }

      // fresh_push — definitive failure; clear the ref and send a new push below.
      lastCheckoutRequestIdRef.current = null;
    }

    // ── Issue a new STK push ─────────────────────────────────────────────────
    try {
      const r = await api.mpesaSTKPush(mpesaPhone, total, `cart_${Date.now()}`);
      // Verify this attempt is still active (not cancelled while the request
      // was in-flight).
      if (isCancelledAttempt(thisAttempt, attemptRef)) return;
      // Store so the next "Try again" press can check whether this push
      // completed while the user was on the timeout screen.
      lastCheckoutRequestIdRef.current = r.checkoutRequestId;
      startMpesaPoll(r.checkoutRequestId, thisAttempt);
    } catch (e) {
      if (isCancelledAttempt(thisAttempt, attemptRef)) return;
      setProcessing(false);
      // Rate limited (429) — the modal stays open so the phone number is
      // preserved, but the alert must offer NO retry button: an immediate
      // "Try again" would let the user bypass the rate limit by tapping.
      if (classifyPaymentInitError(e).kind === 'rate_limited') {
        Alert.alert(RATE_LIMIT_TITLE, RATE_LIMIT_MESSAGE);
        return;
      }
      // The modal stays open so the phone number is preserved for a retry.
      Alert.alert(
        'M-Pesa Unavailable',
        'Failed to send the M-Pesa request. You can try again or place your order with Cash on Delivery.',
        [
          { text: 'Try again', onPress: () => handleMpesa() },
          {
            text: 'Pay with COD instead',
            onPress: () => { setShowMpesaModal(false); setPaymentMethod('cod'); },
            style: 'cancel',
          },
        ],
      );
    }
  }

  // Stripe Checkout — Stripe hosts the card form (PCI-safe, no card data on our server)
  async function handleStripeCheckout() {
    setProcessing(true);
    try {
      const orderId = `cart_${Date.now()}`;
      const session = await api.stripeSession(total, orderId);
      setProcessing(false);
      // Open hosted Stripe checkout — Stripe handles all card data
      await WebBrowser.openBrowserAsync(session.sessionUrl);
      // Always verify session status after the browser closes, regardless of how the
      // user exited (success redirect, cancel, or manual dismiss). Server verifies
      // directly with Stripe; client cannot bypass this check.
      setProcessing(true);
      try {
        await createOrder('stripe', session.sessionId);
      } catch (e) {
        setProcessing(false);
        // Server returns 402 if Stripe session is not paid — surface that to the user
        Alert.alert('Payment not confirmed', (e as Error).message ?? 'Stripe payment was not completed. No order was created.');
      }
    } catch (e) {
      setProcessing(false);
      // Classify: 429 → wait message with only OK (no retry path that would
      // bypass the rate limit); transient blip → retry/COD; else declined.
      const action = classifyPaymentInitError(e);
      if (action.kind === 'rate_limited') {
        Alert.alert(action.title, action.message);
      } else if (action.kind === 'retry_dialog') {
        Alert.alert(
          'Stripe Unavailable',
          'Stripe checkout could not be opened. You can try again or place your order with Cash on Delivery.',
          [
            { text: 'Try again', onPress: () => handleStripeCheckout() },
            {
              text: 'Pay with COD instead',
              onPress: () => setPaymentMethod('cod'),
              style: 'cancel',
            },
          ],
        );
      } else {
        Alert.alert(
          'Payment Declined',
          (e instanceof Error ? e.message : null) ||
            'Your payment could not be completed. Please check your card details and try a different payment method.',
        );
      }
    }
  }

  /**
   * Verify an existing Paystack reference after the browser closes (or after a
   * network error on a previous verify attempt).  Keeping verify separate from
   * init is critical: if the verify call fails (e.g. a 500 mid-request), "Try
   * again" must re-verify the SAME reference rather than opening a new Paystack
   * checkout — re-init would create a new charge reference, losing visibility of
   * the original one and risking a double charge if the first payment completed.
   *
   * Test plan (manual, on-device):
   *
   *   Scenario A — paystackInit 500 (network error before browser opens):
   *     1. Force-fail /api/payments/paystack/init (e.g. kill API server).
   *     2. Tap "Pay with Paystack".
   *     3. Expect: "Paystack Unavailable" alert with "Try again" / "Pay with COD instead".
   *     4. "Try again" → re-enters handlePaystack() fresh (correct, no charge issued yet).
   *     5. "Pay with COD instead" → picker switches to COD, no spinner.
   *
   *   Scenario B — paystackVerify 500 (network error after browser closes):
   *     1. Let init succeed and open the browser.
   *     2. Complete or abandon the Paystack payment in the browser, then close it.
   *     3. Force-fail /api/payments/paystack/verify (e.g. kill API server mid-flight).
   *     4. Expect: "Paystack Unavailable" alert with "Try again" / "Pay with COD instead".
   *     5. "Try again" → calls handlePaystackVerify with the ORIGINAL reference
   *        (no new browser, no new charge reference).
   *     6. "Pay with COD instead" → picker switches to COD, no spinner.
   *
   *   Scenario C — user-cancelled browser (abandoned):
   *     1. Let init succeed, open the browser, then close it without paying.
   *     2. Verify returns status "abandoned" or null.
   *     3. Expect: no alert, no spinner, checkout form back to idle.
   *
   *   Scenario D — successful payment:
   *     1. Let init succeed, complete payment in browser, close browser.
   *     2. Verify returns success → order created, navigates to /order/:id.
   */
  async function handlePaystackVerify(reference: string) {
    setProcessing(true);
    try {
      const verified = await api.paystackVerify(reference);
      setProcessing(false);

      if (verified.success && verified.status === 'success') {
        await createOrder('paystack', reference);
      } else {
        // Branch on the specific Paystack status to give the right advice:
        //   abandoned / null  → user closed the browser; silent, no error shown
        //   failed            → card/mobile-money decline; ask them to check details
        //   anything else     → unexpected non-success; generic "not confirmed" message
        const st = verified.status;
        if (!st || st === 'abandoned') {
          // User cancelled — nothing to do; checkout form returns to idle
        } else if (st === 'failed') {
          Alert.alert(
            'Payment Declined',
            'Your payment was not completed. Please check your card details or try a different payment method.',
          );
        } else {
          Alert.alert(
            'Payment Not Confirmed',
            `Paystack reported status: "${st}". No order was created. Please try again.`,
          );
        }
      }
    } catch (e) {
      setProcessing(false);
      // Classify verification failures without discarding `reference`: a later
      // manual checkout retry can still verify the same payment reference.
      const action = classifyPaymentInitError(e);
      if (action.kind === 'rate_limited') {
        // No buttons array: React Native shows only the default OK action, so
        // the customer cannot immediately bypass the verification rate limit.
        Alert.alert(action.title, action.message);
      } else if (action.kind === 'retry_dialog') {
        Alert.alert(
          'Paystack Unavailable',
          'Paystack could not confirm your payment. Your card has not been charged again. You can try again or place your order with Cash on Delivery.',
          [
            {
              // Retry verification with the SAME reference — do not re-init a new
              // Paystack session, which would lose the original charge reference.
              text: 'Try again',
              onPress: () => handlePaystackVerify(reference),
            },
            {
              text: 'Pay with COD instead',
              onPress: () => setPaymentMethod('cod'),
              style: 'cancel',
            },
          ],
        );
      } else {
        Alert.alert(
          'Payment Declined',
          (e instanceof Error ? e.message : null) ||
            'Your payment could not be completed. Please check your card details and try a different payment method.',
        );
      }
    }
  }

  async function handlePaystack() {
    setProcessing(true);
    let r: { authorizationUrl: string; reference: string } | null = null;
    try {
      r = await api.paystackInit(
        user?.email ?? 'customer@ucfilters.com',
        total,
      );
      setProcessing(false);
    } catch (e) {
      setProcessing(false);
      // Init failed — no payment session was created, so "Try again" safely
      // re-enters handlePaystack() to start a completely fresh attempt.
      // 429 → wait message with only OK: no "Try again" / "Pay with COD"
      // buttons that would let the user bypass the rate limit.
      const action = classifyPaymentInitError(e);
      if (action.kind === 'rate_limited') {
        Alert.alert(action.title, action.message);
        return;
      }
      if (action.kind === 'retry_dialog') {
        Alert.alert(
          'Paystack Unavailable',
          'Paystack is temporarily unavailable. You can try again or place your order with Cash on Delivery.',
          [
            {
              text: 'Try again',
              onPress: () => handlePaystack(),
            },
            {
              text: 'Pay with COD instead',
              onPress: () => setPaymentMethod('cod'),
              style: 'cancel',
            },
          ],
        );
      } else {
        Alert.alert(
          'Payment Declined',
          (e instanceof Error ? e.message : null) ||
            'Your payment could not be completed. Please check your card details and try a different payment method.',
        );
      }
      return;
    }

    // Open Paystack's hosted checkout — Paystack handles all card/mobile-money data.
    // Wrap in its own try-catch: if the OS or WebBrowser rejects the launch, a
    // Paystack session already exists.  Recovery must verify the same reference
    // (not re-init) because the browser may have briefly opened before throwing,
    // meaning payment could theoretically have completed.
    try {
      await WebBrowser.openBrowserAsync(r.authorizationUrl);
    } catch {
      setProcessing(false);
      Alert.alert(
        'Browser Could Not Open',
        'The Paystack checkout page could not be opened. You can try again or place your order with Cash on Delivery.',
        [
          {
            // Verify the existing reference — safer than re-initing, which would
            // create a second charge reference and lose sight of the first.
            text: 'Try again',
            onPress: () => handlePaystackVerify(r!.reference),
          },
          {
            text: 'Pay with COD instead',
            onPress: () => setPaymentMethod('cod'),
            style: 'cancel',
          },
        ],
      );
      return;
    }

    // Always verify after the browser closes — regardless of how the user exited
    // (success, cancel, or manual close).  Use a dedicated helper so that a
    // verify-failure retry re-uses the same reference rather than re-initing.
    await handlePaystackVerify(r.reference);
  }

  async function applyPromoCode() {
    if (!promoInput.trim()) return;
    setPromoValidating(true);
    try {
      const quote = await api.quoteCheckoutPromotion({
        code: promoInput.trim(),
        lineItems: items.map(item => ({ productId: item.id, quantity: item.quantity })),
      });
      setAppliedQuote(quote);
      setUsingReferralDiscount(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setAppliedQuote(null);
      Alert.alert('Code not applied', error instanceof Error ? error.message : 'Could not validate this code. Please try again.');
    } finally {
      setPromoValidating(false);
    }
  }

  async function applyReferralDiscount() {
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to use a referral reward.');
      return;
    }
    setPromoValidating(true);
    try {
      const quote = await api.quoteReferralDiscount({
        lineItems: items.map(item => ({ productId: item.id, quantity: item.quantity })),
      });
      setAppliedQuote(quote);
      setUsingReferralDiscount(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setAppliedQuote(null);
      setUsingReferralDiscount(false);
      Alert.alert('Referral reward unavailable', error instanceof Error ? error.message : 'No referral discount is available for this order.');
    } finally {
      setPromoValidating(false);
    }
  }

  function removePromoCode() {
    setAppliedQuote(null);
    setUsingReferralDiscount(false);
    setPromoInput('');
  }

  /**
   * Create an order on the server and navigate to the order-confirmation screen.
   *
   * Returns `true` when the order was created and the router has navigated away.
   * Returns `false` when order creation failed for a non-retriable reason (the
   *   function has already shown an alert to the user; callers need not show another).
   * Handles retryable order-persistence failures here so every payment method,
   * including COD, preserves the checkout and retries the same order identity.
   * Throws only non-retryable `ApiError` values for payment-specific callers.
   *
   * IMPORTANT: for M-Pesa flows, callers must only clear `lastCheckoutRequestIdRef`
   * after this function returns `true`.  Clearing early — before the order is
   * durably recorded — loses the guard against a double charge when the network
   * fails mid-creation and the customer retries.
   */
  async function createOrder(method: string, reference: string): Promise<boolean> {
    const normalizedPhone = normalizeInstantPhone(
      address.phone.trim(),
      countryCodeFromValue(address.country) ?? undefined,
    );
    if (!normalizedPhone) {
      const fields: AddressErrors = { phone: 'Enter a valid phone number for the selected country.' };
      setAddressErrors(fields);
      Alert.alert('Check your delivery details', fields.phone);
      return false;
    }
    // Use this local payload directly. setAddress() is asynchronous and the
    // current request must not send the stale, pre-normalized value.
    const normalizedShippingAddress = { ...address, phone: normalizedPhone };
    const orderIdentity = retainCheckoutOrderIdentity(orderIdentityRef.current);
    orderIdentityRef.current = orderIdentity;
    const stableReference = method === 'cod' ? orderIdentity.codReference : reference;
    setProcessing(true);
    try {
      const order = await api.createOrder({
        lineItems: items.map(i => ({ productId: i.id, quantity: i.quantity })),
        paymentMethod: method,
        paymentReference: stableReference,
        shippingAddress: normalizedShippingAddress,
        promoCode: appliedQuote?.promotion.code,
        applyReferralDiscount: usingReferralDiscount,
        idempotencyKey: orderIdentity.idempotencyKey,
      });
      if (method === 'paystack' || method === 'mpesa' || method === 'cod' || method === 'stripe') {
        trackEvent('order_submitted', {
          paymentMethod: method,
          itemCount: items.reduce((count, item) => count + item.quantity, 0),
        });
      }
      clearCart();
      setMpesaWaiting(false);
      setProcessing(false);
      router.replace(`/order/${order.id}` as never);
      return true;
    } catch (e) {
      setProcessing(false);
      setMpesaWaiting(false);
      // Server-side delivery-details rejection (COD validation) — highlight
      // the offending fields and show the first message. This should be rare
      // because the same checks run client-side before submitting.
      if (e instanceof ApiError && e.status === 400 && e.body['fields']) {
        const fields = e.body['fields'] as AddressErrors;
        setAddressErrors(fields);
        const first = Object.values(fields)[0];
        Alert.alert('Check your delivery details', typeof first === 'string' ? first : 'Please review your name and phone number.');
        return false;
      }
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert(
          'Promotion could not be completed',
          'Your promotion was not durably saved with this order. No payment/order retry was made. Please try again or continue without the code.',
        );
        return false;
      }
      if (!(e instanceof ApiError) || e.retryable) {
        Alert.alert(
          'Checkout temporarily unavailable',
          'We could not confirm your order with the store. Your cart and delivery details are still here, and you have not been charged again.',
          [
            {
              text: 'Try again',
              onPress: () => { void createOrder(method, reference); },
            },
            { text: 'Not now', style: 'cancel' },
          ],
        );
        return false;
      }
      // Non-retryable payment errors still belong to the payment-specific
      // caller, which can show decline or authentication advice.
      if (e instanceof ApiError) throw e;
      Alert.alert('Error', 'Order could not be created. Please contact support.');
      return false;
    }
  }

  if (mpesaWaiting) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 20 }]}>
        <View style={[styles.mpesaWait, { backgroundColor: '#00A65118', borderColor: '#00A651' }]}>
          <Ionicons name="phone-portrait-outline" size={40} color="#00A651" />
        </View>
        <Text style={[styles.waitTitle, { color: colors.text }]}>Waiting for M-Pesa</Text>
        <Text style={[styles.waitSub, { color: colors.mutedForeground, textAlign: 'center', paddingHorizontal: 40 }]}>
          A prompt has been sent to {mpesaPhone}. Enter your M-Pesa PIN to complete payment.
        </Text>
        <ActivityIndicator color="#00A651" size="large" />
        <TouchableOpacity onPress={() => { cancelMpesaPoll(attemptRef, pollRef); setMpesaWaiting(false); setProcessing(false); }}>
          <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
        </TouchableOpacity>
        {/* Alison appears when the payment feels delayed (after ~10 s of waiting) */}
        <AlisonBubble
          message={`${user?.firstName?.trim() ? `${user.firstName.trim()}, y` : 'Y'}our M-Pesa payment is taking a moment — that's normal. I am here to help with payments, replacement filters or other needs.`}
          appearDelayMs={10000}
          bottomOffset={40}
        />
      </View>
    );
  }

  // Show the load-error recovery UI as its own guard so the !cartHydrated
  // block below remains a pure spinner (required by the hydration test tripwire).
  if (cartLoadError) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 16 }]}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.border} />
        <Text style={[styles.waitTitle, { color: colors.text }]}>Couldn't load your basket</Text>
        <Text style={[styles.waitSub, { color: colors.mutedForeground, textAlign: 'center', paddingHorizontal: 40 }]}>
          There was a problem reading your saved cart.
        </Text>
        <TouchableOpacity onPress={refreshCart} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!cartHydrated) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        {/* Keep support in the scroll flow so it never covers address/payment taps. */}
        <AlisonBubble message={alisonGreeting} placement="inline" />
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Delivery Address</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.field}>
            <CountryPicker
              value={countryCodeFromValue(address.country) ?? 'KE'}
              onChange={code => setAddress(prev => ({ ...prev, country: code }))}
              colors={colors}
              label="Phone country"
            />
          </View>
          {ADDRESS_FIELDS.map(f => (
            <View key={f.key} style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
              <TextInput
                value={address[f.key]}
                onChangeText={v => {
                  setAddress(prev => ({ ...prev, [f.key]: v }));
                  setAddressErrors(prev => (prev[f.key] ? { ...prev, [f.key]: undefined } : prev));
                }}
                placeholder={f.placeholder}
                placeholderTextColor={colors.border}
                keyboardType={f.keyboard ?? 'default'}
                style={[styles.fieldInput, {
                  color: colors.text,
                  borderColor: addressErrors[f.key] ? '#EF4444' : colors.border,
                }]}
              />
              {addressErrors[f.key] ? (
                <Text style={styles.fieldError}>{addressErrors[f.key]}</Text>
              ) : null}
            </View>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Payment Method</Text>
        <PaymentMethodPicker
          selected={paymentMethod}
          enabled={paymentsConfig?.methods}
          onChange={(method) => {
            // Only reset state when the user genuinely switches to a different
            // method.  Tapping the already-selected row must be a no-op so
            // that an in-flight payment cannot be unlocked by tapping its own
            // method row.
            if (method === paymentMethod) return;
            // Cancel any in-flight M-Pesa poll so stale callbacks don't act
            // after the method has switched.
            cancelMpesaPoll(attemptRef, pollRef);
            setMpesaWaiting(false);
            setProcessing(false);
            setPaymentMethod(method);
          }}
        />

        {/* Promo / referral code */}
        <TouchableOpacity onPress={() => setShowPromoField(v => !v)}
          style={[styles.promoToggle, { borderColor: colors.border }]}>
          <Ionicons name="gift-outline" size={16} color={colors.primary} />
          <Text style={[styles.promoToggleText, { color: colors.primary }]}>
            {appliedQuote ? (usingReferralDiscount ? 'Referral reward applied' : `Code applied: ${appliedQuote.promotion.code}`) : 'Have a promo code or referral reward?'}
          </Text>
          <Ionicons name={showPromoField ? 'chevron-up' : 'chevron-down'} size={14} color={colors.mutedForeground} />
        </TouchableOpacity>

        {showPromoField && (
          <View style={[styles.promoBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {appliedQuote ? (
              <View style={styles.promoApplied}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.promoAppliedTitle, { color: '#005d8f' }]}>
                    🎉 {usingReferralDiscount ? 'Your referral reward is applied' : (appliedQuote.promotion.title ?? appliedQuote.promotion.label ?? 'Promotion applied')}
                  </Text>
                  <Text style={[styles.promoAppliedSub, { color: colors.mutedForeground }]}>Server-calculated discount: KES {appliedQuote.discountAmount.toLocaleString('en-KE')}</Text>
                </View>
                <TouchableOpacity onPress={removePromoCode}>
                  <Ionicons name="close-circle" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {user && (
                  <TouchableOpacity onPress={applyReferralDiscount} disabled={promoValidating}
                    style={[styles.referralApplyBtn, { borderColor: colors.primary }]}>
                    <Ionicons name="gift-outline" size={16} color={colors.primary} />
                    <Text style={[styles.referralApplyText, { color: colors.primary }]}>Apply my available referral reward</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.promoRow}>
                  <TextInput
                    value={promoInput} onChangeText={v => { setPromoInput(v.toUpperCase()); setAppliedQuote(null); setUsingReferralDiscount(false); }}
                    placeholder="Enter promo code" autoCapitalize="characters"
                    placeholderTextColor={colors.border}
                    style={[styles.promoInput, { color: colors.text, borderColor: colors.border }]}
                  />
                  <TouchableOpacity onPress={applyPromoCode} disabled={promoValidating}
                    style={[styles.promoApplyBtn, { backgroundColor: '#005d8f' }]}>
                    {promoValidating
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.promoApplyText}>Apply</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>Order Summary</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {items.map(i => (
            <View key={i.id} style={styles.sumRow}>
              <Text style={[styles.sumItemName, { color: colors.text }]} numberOfLines={1}>{i.name} ×{i.quantity}</Text>
              <Text style={[styles.sumItemPrice, { color: colors.text }]}>KES {(i.price * i.quantity).toLocaleString()}</Text>
            </View>
          ))}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.sumRow}>
            <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>Delivery</Text>
            <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>KES {DELIVERY_FEE.toLocaleString()}</Text>
          </View>
          {appliedQuote && (
            <View style={styles.sumRow}>
              <Text style={[styles.sumLabel, { color: '#005d8f' }]}>
                Discount ({usingReferralDiscount ? 'Referral reward' : appliedQuote.promotion.code})
              </Text>
              <Text style={[styles.sumLabel, { color: '#005d8f' }]}>– KES {appliedQuote.discountAmount.toLocaleString('en-KE')}</Text>
            </View>
          )}
          <View style={styles.sumRow}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>Total</Text>
            <Text style={[styles.totalValue, { color: colors.primary }]}>KES {total.toLocaleString('en-KE')}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.background, borderColor: colors.border,
        paddingBottom: Math.max(16, insets.bottom + 8, Platform.OS === 'web' ? 34 : 0) }]}>
        <TouchableOpacity onPress={handleConfirm} disabled={processing}
          style={[styles.confirmBtn, { backgroundColor: processing ? colors.muted : colors.primary }]}>
          {processing ? <ActivityIndicator color="#fff" size="small" /> : (
            <Text style={styles.confirmBtnText}>
              {paymentMethod === 'mpesa' ? 'Send M-Pesa Request' :
               paymentMethod === 'stripe' ? 'Pay with Stripe Checkout' :
               paymentMethod === 'paystack' ? 'Pay with Paystack' : 'Place Order (COD)'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* M-Pesa modal */}
      <Modal visible={showMpesaModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>M-Pesa Payment</Text>
            <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
              Enter your Safaricom M-Pesa number to receive a payment prompt
            </Text>
            <Text style={[styles.modalAmount, { color: '#00A651' }]}>KES {total.toLocaleString('en-KE')}</Text>
            <TextInput
              value={mpesaPhone} onChangeText={setMpesaPhone}
              placeholder="0712 345 678" keyboardType="phone-pad"
              placeholderTextColor={colors.border}
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
            />
            <TouchableOpacity onPress={handleMpesa} disabled={processing}
              style={[styles.modalBtn, { backgroundColor: '#00A651' }]}>
              {processing ? <ActivityIndicator color="#fff" size="small" /> :
                <Text style={styles.modalBtnText}>Send Payment Request</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                // Invalidate any in-flight STK-push request so its async
                // callbacks are discarded when they eventually resolve.
                cancelMpesaPoll(attemptRef, pollRef);
                setProcessing(false);
                setShowMpesaModal(false);
              }}
              style={styles.modalCancel}
            >
              <Text style={[styles.modalCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 120 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '500' as const },
  fieldInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  fieldError: { fontSize: 12, color: '#EF4444', marginTop: 2 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sumItemName: { fontSize: 13, flex: 1, marginRight: 8 },
  sumItemPrice: { fontSize: 13, fontWeight: '500' as const },
  divider: { height: 1 },
  sumLabel: { fontSize: 14 },
  totalLabel: { fontSize: 16, fontWeight: '700' as const },
  totalValue: { fontSize: 18, fontWeight: '800' as const },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: Platform.OS === 'web' ? 34 : 16, borderTopWidth: 1,
  },
  confirmBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, textAlign: 'center' },
  modalSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  modalAmount: { fontSize: 32, fontWeight: '800' as const, textAlign: 'center' },
  modalInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  modalBtn: { borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  modalBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' as const },
  modalCancel: { alignItems: 'center', paddingVertical: 8 },
  modalCancelText: { fontSize: 15 },
  mpesaWait: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  waitTitle: { fontSize: 22, fontWeight: '700' as const },
  waitSub: { fontSize: 14, lineHeight: 22 },
  cancelText: { fontSize: 14, padding: 12 },
  retryBtn: { paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' as const },
  promoToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
  },
  promoToggleText: { flex: 1, fontSize: 14, fontWeight: '500' as const },
  promoBox: { borderWidth: 1, borderRadius: 10, padding: 12 },
  promoRow: { flexDirection: 'row', gap: 8 },
  promoInput: {
    flex: 1, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15,
  },
  promoApplyBtn: { borderRadius: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  promoApplyText: { color: '#fff', fontSize: 14, fontWeight: '700' as const },
  referralApplyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderRadius: 8, paddingVertical: 10, marginBottom: 10 },
  referralApplyText: { fontSize: 13, fontWeight: '700' as const },
  promoApplied: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  promoAppliedTitle: { fontSize: 14, fontWeight: '700' as const },
  promoAppliedSub: { fontSize: 12, marginTop: 2 },
});
