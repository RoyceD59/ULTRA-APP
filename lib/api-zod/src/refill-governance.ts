import { z } from "zod";
import { refillSimulationSchema } from "./refill-readiness.js";

export const refillReasonSchema = z.object({
  reason: z.string().trim().min(8).max(500),
}).strict();

export const refillCampaignProposalSchema = z.object({
  campaignKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
  version: z.number().int().positive().max(1_000_000),
  stationId: z.string().trim().min(1).max(100),
  eligibilityPolicy: z.literal("manual_review"),
  maxGrants: z.number().int().positive().max(1_000_000),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  scenario: refillSimulationSchema,
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end must follow the start" });
  }
  if (value.scenario.campaignVersion !== `${value.campaignKey}:${value.version}`) {
    ctx.addIssue({ code: "custom", path: ["scenario", "campaignVersion"], message: "The version must match the campaign" });
  }
  if (value.scenario.cashChargeMinor !== 0) {
    ctx.addIssue({ code: "custom", path: ["scenario", "cashChargeMinor"], message: "Promotional rules cannot charge a customer" });
  }
});
export type RefillCampaignProposal = z.infer<typeof refillCampaignProposalSchema>;
