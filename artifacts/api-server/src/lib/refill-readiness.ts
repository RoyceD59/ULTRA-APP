import type { RefillCapabilities } from "@workspace/api-zod/refill-readiness";

const enabled = (value: string | undefined) => value?.trim().toLowerCase() === "true";

export function getRefillCapabilities(env: NodeJS.ProcessEnv = process.env): RefillCapabilities {
  return {
    version: 1, careOverview: enabled(env["UC_CARE_OVERVIEW_PREVIEW"]),
    // The discovery gate is incomplete. Environment switches alone must never
    // authorize operations whose posting/access controls have not been delivered.
    promoRefill: false, paidRefill: false, moneyWallet: false,
    paidCare: false, automaticCollection: false,
  };
}

export function getRefillReadiness(env: NodeJS.ProcessEnv = process.env) {
  return {
    capabilities: getRefillCapabilities(env),
    phase: "discovery" as const,
    activationAllowed: false as const,
    blockers: [
      { id: "station_access", message: "Vendor-to-station permissions and quality suspension are not implemented." },
      { id: "posting_owner", message: "Rewards have multiple writers; a shared transaction posting boundary is required." },
      { id: "volume_holds", message: "Credit lots, vendor funding, budget holds and fulfilment uniqueness are not implemented." },
      { id: "rule_approval", message: "Immutable rule versions and maker-checker activation are not implemented." },
      { id: "customer_confirmation", message: "Quote-bound customer approval and delivery acknowledgment are not implemented." },
      { id: "event_delivery", message: "No general refill outbox/inbox with aggregate-version checks was found." },
      { id: "release_evidence", message: "Migration, concurrency, device rehearsal and reconciliation evidence are still required." },
    ],
    flagManifest: [
      { server: "UC_CARE_OVERVIEW_PREVIEW", client: "EXPO_PUBLIC_UC_CARE_OVERVIEW_PREVIEW", default: false, scope: "Existing free-member journeys only" },
      { server: null, client: null, default: false, scope: "Promo refill, paid refill, wallet, paid care and automatic collection cannot be activated in this foundation" },
    ],
  };
}
