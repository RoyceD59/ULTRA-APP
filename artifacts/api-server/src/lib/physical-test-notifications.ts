import { pool } from "@workspace/db";
import { sendSms, waterTestConfirmationSms } from "./sms.js";
import { sendEmail, buildWaterTestConfirmationEmail } from "./email.js";
import { notifyOffice } from "../routes/uc.js";
import { logger } from "./logger.js";

export type PhysicalTestNotification = {
  ticketId: string; userId?: string; firstName: string; phone: string;
  address: string; source: string; concerns: string; freeWaterTest: boolean; promoCode: string;
};
let injectedSender: ((input: PhysicalTestNotification) => Promise<void>) | undefined;
export function setPhysicalTestNotificationSenderForTests(sender?: typeof injectedSender) { injectedSender = sender; }

/** Called only after the NEW request commits, never on replay. */
export async function notifyPhysicalTest(input: PhysicalTestNotification) {
  if (injectedSender) { await injectedSender(input); return; }
  const { ticketId: testId, firstName, address, source: waterSource, concerns, freeWaterTest } = input;
  sendSms(input.phone, waterTestConfirmationSms({ testId, firstName, address, freeWaterTest }),
    { template: "water_test_confirmation", testId });
  const contact = input.userId ? await pool.query("SELECT email FROM uc_users WHERE id::text=$1 AND deleted_at IS NULL", [input.userId]) : null;
  if (contact?.rows[0]?.email) {
    const email = contact.rows[0].email;
    await sendEmail({ to: email, ...buildWaterTestConfirmationEmail({ testId, firstName, email, address, waterSource, concerns, freeWaterTest }),
      template: "water_test_confirmation", testId }).catch(error => logger.warn({error,testId},"Water test confirmation delivery failed"));
  }
  await notifyOffice(`Physical Water Test Request ${testId}`, [
    `Customer: ${firstName}`, `Phone: ${input.phone}`, `Address: ${address}`,
    `Source: ${waterSource}`, `Concerns: ${concerns}`,
    ...(freeWaterTest ? [`Verified free water test entitlement: ${input.promoCode}. No payment or refund processed.`] : []),
  ], {testId});
}