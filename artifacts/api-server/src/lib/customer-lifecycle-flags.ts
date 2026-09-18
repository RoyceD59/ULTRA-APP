/**
 * Rollout controls for the canonical customer lifecycle migration.
 *
 * These values are intentionally environment-backed and default to false.
 * Do not add credentials, provider URLs, or other secret configuration here:
 * the public projection below is safe to expose to clients once its route is
 * implemented.
 */
export interface CustomerLifecycleFlags {
  canonicalReads: boolean;
  dualWrites: boolean;
  legacyReviewSubmission: boolean;
  canonicalGlobalImpact: boolean;
  nearbyDistanceTiers: boolean;
  missionControlStaffPreview: boolean;
}

export interface PublicCustomerLifecycleFlags {
  canonicalReads: boolean;
  legacyReviewSubmission: boolean;
  canonicalGlobalImpact: boolean;
  nearbyDistanceTiers: boolean;
}

const enabled = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === "true";

export function getCustomerLifecycleFlags(
  environment: NodeJS.ProcessEnv = process.env,
): CustomerLifecycleFlags {
  return {
    canonicalReads: enabled(environment["UC_CANONICAL_READS"]),
    dualWrites: enabled(environment["UC_CANONICAL_DUAL_WRITES"]),
    legacyReviewSubmission: enabled(environment["UC_LEGACY_REVIEW_SUBMISSION"]),
    canonicalGlobalImpact: enabled(environment["UC_CANONICAL_GLOBAL_IMPACT"]),
    nearbyDistanceTiers: enabled(environment["UC_NEARBY_DISTANCE_TIERS"]),
    missionControlStaffPreview: enabled(environment["UC_MISSION_CONTROL_STAFF_PREVIEW"]),
  };
}

/** Only these booleans may cross a public configuration boundary. */
export function getPublicCustomerLifecycleFlags(
  environment: NodeJS.ProcessEnv = process.env,
): PublicCustomerLifecycleFlags {
  const flags = getCustomerLifecycleFlags(environment);
  return {
    canonicalReads: flags.canonicalReads,
    legacyReviewSubmission: flags.legacyReviewSubmission,
    canonicalGlobalImpact: flags.canonicalGlobalImpact,
    nearbyDistanceTiers: flags.nearbyDistanceTiers,
  };
}

export function isCustomerLifecycleFlagEnabled(
  flag: keyof CustomerLifecycleFlags,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return getCustomerLifecycleFlags(environment)[flag];
}