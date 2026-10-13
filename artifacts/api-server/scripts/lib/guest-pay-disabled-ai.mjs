// Only the isolated fixture's module hook may substitute this dependency.
// Never return a synthetic AI answer or forward a request to a real integration.
if (process.env.GUEST_PAY_FIXTURE !== "local-only" || process.env.NODE_ENV !== "guestpay-fixture") {
  throw new Error("Disabled integration module is fixture-only");
}
function disabled() {
  throw Object.assign(new Error("AI is disabled in the guest-payment preparation fixture"), {
    code: "FIXTURE_AI_DISABLED",
  });
}
export const anthropic = Object.freeze({
  messages: Object.freeze({ create: disabled, stream: disabled }),
});
export const batchProcess = disabled;
