export const IMPACT_CONFIG = {
  bottleVolumeLitres: 0.5,
  co2eKgPer500mlBottle: 0.03993056,
  referenceLitres: 576,
  referenceAnnualSavingKes: 16000,
} as const;

export function calculateImpact(totalFilteredLitres: number) {
  const litres = Math.max(totalFilteredLitres || 0, 0);

  const bottleEquivalent =
    litres / IMPACT_CONFIG.bottleVolumeLitres;

  const co2eAvoidedKg =
    bottleEquivalent *
    IMPACT_CONFIG.co2eKgPer500mlBottle;

  const estimatedAnnualSavingKes =
    litres <= 0
      ? 0
      : Math.round(
          (litres / IMPACT_CONFIG.referenceLitres) *
          IMPACT_CONFIG.referenceAnnualSavingKes
        );

  return {
    litres,
    bottleEquivalent,
    co2eAvoidedKg,
    estimatedAnnualSavingKes,
  };
}

export const MILESTONES = [
  { min: 0, max: 500, label: "0–500 L" },
  { min: 500, max: 2000, label: "500–2,000 L" },
  { min: 2000, max: 5000, label: "2,000–5,000 L" },
  { min: 5000, max: 10000, label: "5,000–10,000 L" },
  { min: 10000, max: 50000, label: "10,000–50,000 L" },
];

export function getActiveMilestone(totalLitres: number) {
  const milestone = MILESTONES.find(m => totalLitres < m.max) || MILESTONES[MILESTONES.length - 1];
  const progressLitres = Math.max(0, totalLitres - milestone.min);
  const milestoneRange = milestone.max - milestone.min;
  const progressPercent = Math.min(100, Math.max(0, Math.floor((progressLitres / milestoneRange) * 100)));
  const remaining = Math.max(0, milestone.max - totalLitres);

  return {
    ...milestone,
    progressPercent,
    remaining
  };
}
