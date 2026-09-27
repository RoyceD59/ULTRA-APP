/**
 * Pure, dependency-free classifier for M-Pesa STK-push status responses.
 *
 * Extracted from the `startMpesaPoll` branching in app/checkout.tsx so the
 * decision tree can be unit-tested without React Native, Alert, or Expo.
 *
 * The checkout component handles all side-effects (Alert.alert, createOrder,
 * setPaymentMethod, etc.); this module only maps a status response to an
 * action kind + display strings.
 */

export interface MpesaStatusResponse {
  status: "success" | "pending" | "failed";
  retriable?: boolean;
  resultDesc?: string;
}

export type MpesaStatusAction =
  | { kind: "create_order" }
  | { kind: "continue_polling" }
  | {
      kind: "hint_dialog";
      title: string;
      message: string;
    }
  | {
      kind: "retry_dialog";
      title: string;
      message: string;
    };

/**
 * Returns `true` when a settled poll action means `lastCheckoutRequestIdRef`
 * must be cleared immediately — i.e. the prior STK push is definitively done
 * and re-querying it on the next "Try again" would be pointless or wrong.
 *
 * The condition is centralised here (rather than inlined in checkout.tsx) so
 * both the component and its tests import the same rule.  If the clearing
 * logic ever changes, updating this function is the single source of truth.
 *
 * Note: `create_order` is intentionally excluded — the ref is only cleared
 * *after* `createOrder` succeeds (see checkout.tsx).  This function covers
 * the failure paths (hint_dialog / retry_dialog) where clearing is immediate.
 */
export function pollSettleClearsRef(
  action: MpesaStatusAction,
): action is Extract<MpesaStatusAction, { kind: "hint_dialog" | "retry_dialog" }> {
  return action.kind === "hint_dialog" || action.kind === "retry_dialog";
}

/**
 * Classify a Daraja status response into one of four actions:
 *
 *  - `create_order`      — payment confirmed; proceed to create the order
 *  - `continue_polling`  — transaction still in progress; keep the interval running
 *  - `hint_dialog`       — definitive decline (wrong PIN, user cancelled,
 *                          insufficient funds); show a dismissal + PIN hint
 *  - `retry_dialog`      — transient error (DS timeout, unknown code);
 *                          show "Try again / Pay with COD" options
 */
export function classifyMpesaStatus(resp: MpesaStatusResponse): MpesaStatusAction {
  if (resp.status === "success") {
    return { kind: "create_order" };
  }

  if (resp.status === "pending") {
    return { kind: "continue_polling" };
  }

  // status === "failed"
  // retriable===false → definitive user decline: wrong PIN / cancelled / insufficient funds.
  // Do NOT offer "Try again" — it would be confusing or pointless.
  if (resp.retriable === false) {
    return {
      kind: "hint_dialog",
      title: "Payment Not Completed",
      message:
        (resp.resultDesc ?? "M-Pesa payment was not completed.") +
        "\n\nIf you entered the wrong PIN, open the Safaricom app to verify your M-Pesa PIN before trying again.",
    };
  }

  // retriable===true (or undefined) → transient error or unknown code.
  // Offer "Try again / Pay with COD".
  return {
    kind: "retry_dialog",
    title: "M-Pesa Failed",
    message:
      resp.resultDesc ??
      "M-Pesa payment was not completed. You can try again or switch to Cash on Delivery.",
  };
}
