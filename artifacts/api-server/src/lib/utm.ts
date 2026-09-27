/**
 * UTM encoding for promo codes.
 *
 * Every order placed with a promo code carries campaign attribution encoded
 * as standard UTM parameters, so bookkeeping/CRM imports and analytics tools
 * (GA, Meta, HubSpot, …) can attribute revenue to the campaign without any
 * custom mapping:
 *
 *   utm_source   = uc-companion   (where the code was redeemed)
 *   utm_medium   = promo-code
 *   utm_campaign = <sanitized promo code>  e.g. "WATER10" → "water10"
 *
 * The same encoding is used in the structured receipt JSON, the orders CSV
 * `utm` column, and on store links inside receipt emails.
 */

export interface PromoUtm {
  utm_source:   string;
  utm_medium:   string;
  utm_campaign: string;
}

/** Lowercase and reduce to the analytics-safe charset [a-z0-9._-]. */
function sanitizeCampaign(code: string): string {
  return code
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** UTM parameters for a promo code, or null when there is no code. */
export function promoUtmParams(promoCode?: string | null): PromoUtm | null {
  const code = (promoCode ?? "").trim();
  if (!code) return null;
  const campaign = sanitizeCampaign(code);
  if (!campaign) return null;
  return {
    utm_source:   "uc-companion",
    utm_medium:   "promo-code",
    utm_campaign: campaign,
  };
}

/** URL-encoded UTM query string ("utm_source=…&utm_medium=…&utm_campaign=…"), or "" when no promo code. */
export function promoUtmQuery(promoCode?: string | null): string {
  const params = promoUtmParams(promoCode);
  return params ? new URLSearchParams(params as unknown as Record<string, string>).toString() : "";
}

/** Store URL carrying the promo's UTM attribution (plain store URL when no promo). */
export function storeUrlWithUtm(promoCode?: string | null, base = "https://ucfilters.co.ke"): string {
  const query = promoUtmQuery(promoCode);
  return query ? `${base}/?${query}` : base;
}
