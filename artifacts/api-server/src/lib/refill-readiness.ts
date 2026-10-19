import type { RefillCapabilities } from "@workspace/api-zod/refill-readiness";
import type { RefillFeatures } from "./refill-features.js";

const DEFAULT_FEATURES: RefillFeatures = {
  careOverview: false,
  refillGovernance: false,
};

export function getRefillCapabilities(features: RefillFeatures = DEFAULT_FEATURES): RefillCapabilities {
  return {
    version: 1, careOverview: features.careOverview,
    // The discovery gate is incomplete. Environment switches alone must never
    // authorize operations whose posting/access controls have not been delivered.
    promoRefill: false, paidRefill: false, moneyWallet: false,
    paidCare: false, automaticCollection: false,
  };
}

export function getRefillReadiness(features: RefillFeatures = DEFAULT_FEATURES) {
  return {
    capabilities: getRefillCapabilities(features),
    phase: "discovery" as const,
    activationAllowed: false as const,
    blockers: [
      { id: "station_access", message: "Station/operator review is in preview; dispenser enforcement and quality clearance evidence are still required." },
      { id: "posting_owner", message: "Rewards have multiple writers; a shared transaction posting boundary is required." },
      { id: "volume_holds", message: "Credit lots, vendor funding, budget holds and fulfilment uniqueness are not implemented." },
      { id: "rule_approval", message: "Versioned rules and independent review are in preview; no rule can activate customer credit or dispensing." },
      { id: "customer_confirmation", message: "Quote-bound customer approval and delivery acknowledgment are not implemented." },
      { id: "event_delivery", message: "No general refill outbox/inbox with aggregate-version checks was found." },
      { id: "release_evidence", message: "Migration, concurrency, device rehearsal and reconciliation evidence are still required." },
    ],
    flagManifest: [
      { setting: "careOverview", default: false, scope: "Persisted admin activation; existing free-member journeys only" },
      { setting: "refillGovernance", default: false, scope: "Persisted admin activation; station, operator and inert campaign-rule review only" },
      { setting: null, default: false, scope: "Promo refill, paid refill, wallet, paid care and automatic collection cannot be activated in this foundation" },
    ],
  };
}
