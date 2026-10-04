import type { ResendEmail } from "./resend.js";

type RecoveryAlertEmail = ResendEmail & {
  meta: { template: string; orderId: number };
};

/**
 * Retry only recovery alerts, not every email. Reuse the provider key so a
 * timed-out acceptance cannot produce a second email on the next attempt.
 * Each call still passes through sendViaResend's notification audit.
 */
export async function sendRecoveryAlertEmail(
  email: RecoveryAlertEmail,
  send: (email: ResendEmail) => Promise<boolean>,
  dependencies: {
    wait?: (ms: number) => Promise<void>;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  } = {},
): Promise<boolean> {
  const wait = dependencies.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const warn = dependencies.warn ?? console.warn;
  const error = dependencies.error ?? console.error;
  const context = `orderId=${email.meta.orderId} template=${email.meta.template}`;
  const idempotencyKey = `recovery-alert-${email.meta.template}-${email.meta.orderId}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let accepted = false;
    try {
      accepted = await send({
        ...email,
        idempotencyKey,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // The production helper returns false, but also handle unexpected throws.
      // Do not log provider errors here: they may contain customer information.
    }
    if (accepted) return true;
    if (attempt === 1) {
      warn(`[payments] Recovery alert email failed; retrying in 1000ms (${context})`);
      await wait(1_000);
    }
  }

  error(`[payments] RECOVERY_ALERT_EMAIL_FAILED: both email attempts failed; check recovery orders for manual fulfilment (${context}). SMS is independent and may not be configured.`);
  return false;
}