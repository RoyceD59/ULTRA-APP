import { z } from "zod";

export const refillCapabilitiesSchema = z.object({
  version: z.literal(1),
  careOverview: z.boolean(),
  promoRefill: z.literal(false),
  paidRefill: z.literal(false),
  moneyWallet: z.literal(false),
  paidCare: z.literal(false),
  automaticCollection: z.literal(false),
}).strict();
export type RefillCapabilities = z.infer<typeof refillCapabilitiesSchema>;

const minorUnits = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const refillCostNames = [
  "waterPerLitreMinor", "paymentMinor", "deliverySupportMinor",
  "benefitObligationMinor", "taxMinor",
] as const;

/** A scenario only. These inputs never authorize a quote, payment or posting. */
export const refillSimulationSchema = z.object({
  pricingVersion: z.string().trim().min(1).max(100),
  campaignVersion: z.string().trim().min(1).max(100),
  volumeMl: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  cashChargeMinor: minorUnits,
  sponsorFundingMinor: minorUnits,
  costs: z.object({
    waterPerLitreMinor: minorUnits.nullable(),
    paymentMinor: minorUnits.nullable(),
    deliverySupportMinor: minorUnits.nullable(),
    benefitObligationMinor: minorUnits.nullable(),
    taxMinor: minorUnits.nullable(),
  }).strict(),
}).strict();
export type RefillSimulationInput = z.infer<typeof refillSimulationSchema>;
export type RefillSimulationResult = {
  status: "missing_costs" | "complete";
  missingCosts: string[];
  totalCostMinor: number | null;
  contributionMinor: number | null;
  promotionalMrrMinor: 0;
  activationAllowed: false;
  rounding: "water cost rounded up to one KES minor unit";
  pricingVersion: string;
  campaignVersion: string;
};

export function simulateRefillEconomics(value: unknown): RefillSimulationResult {
  const parsed = refillSimulationSchema.safeParse(value);
  if (!parsed.success) throw new RangeError("Invalid refill simulation input");
  const input = parsed.data;
  const missingCosts = refillCostNames.filter((name) => input.costs[name] === null);
  const base = {
    missingCosts, promotionalMrrMinor: 0 as const, activationAllowed: false as const,
    rounding: "water cost rounded up to one KES minor unit" as const,
    pricingVersion: input.pricingVersion, campaignVersion: input.campaignVersion,
  };
  if (missingCosts.length) {
    return { ...base, status: "missing_costs", totalCostMinor: null, contributionMinor: null };
  }
  // Use integer arithmetic even when multiplication exceeds Number's safe range.
  const waterCost = (BigInt(input.volumeMl) * BigInt(input.costs.waterPerLitreMinor!) + 999n) / 1000n;
  const total = waterCost + BigInt(input.costs.paymentMinor!) + BigInt(input.costs.deliverySupportMinor!)
    + BigInt(input.costs.benefitObligationMinor!) + BigInt(input.costs.taxMinor!);
  const funding = BigInt(input.cashChargeMinor) + BigInt(input.sponsorFundingMinor);
  const contribution = funding - total;
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (total > limit || funding > limit || contribution < -limit || contribution > limit) {
    throw new RangeError("Scenario totals exceed the supported integer range");
  }
  return { ...base, status: "complete", totalCostMinor: Number(total), contributionMinor: Number(contribution) };
}
