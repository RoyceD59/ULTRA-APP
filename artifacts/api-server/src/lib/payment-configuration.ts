// Demo payments must never be inferred from missing credentials. Only explicitly
// non-production processes may simulate payments; unset/unknown environments fail closed.
export function paymentMocksAllowed(): boolean {
  return process.env["NODE_ENV"] === "development" || process.env["NODE_ENV"] === "test";
}

export function mpesaConfigured(): boolean {
  const shortcode = process.env["MPESA_SHORTCODE"]?.trim();
  return !!shortcode && /^\d{4,10}$/.test(shortcode) &&
    !!process.env["MPESA_PASSKEY"]?.trim() &&
    !!process.env["MPESA_CONSUMER_KEY"]?.trim() &&
    !!process.env["MPESA_CONSUMER_SECRET"]?.trim();
}

export function paymentProviderConfigured(method: string): boolean {
  if (method === "mpesa") return mpesaConfigured();
  if (method === "paystack") return !!process.env["PAYSTACK_SECRET_KEY"]?.trim();
  if (method === "stripe") return !!process.env["STRIPE_SECRET_KEY"]?.trim();
  return false;
}
