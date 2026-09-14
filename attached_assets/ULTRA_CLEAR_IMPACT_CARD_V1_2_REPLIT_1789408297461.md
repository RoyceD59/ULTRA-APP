# Ultra Clear Impact Card v1.2 — Replit Modification Guide

**Scope:** Modify the existing Ultra Clear Companion App **Impact Card only**.

## Final behavior

The user enters **litres consumed since the previous update**. This is an increment, not a replacement lifetime total.

Example:

```text
Current stored total = 576 L
User enters = 20 L
Tap Add
New total = 596 L
```

After a successful Add, recalculate:

- cumulative litres filtered;
- 500ml plastic bottles avoided;
- estimated bottle-related CO₂e avoided;
- estimated annual saving;
- active milestone and progress.

## Compact UI

```text
┌─────────────────────────────────────┐
│  Ultra Clear                    JR  │
│                                     │
│  YOUR ULTRA CLEAR IMPACT            │
│                                     │
│  Add litres consumed                │
│  ┌───────────────────┐ ┌─────────┐  │
│  │ 20 litres         │ │  Add    │  │
│  └───────────────────┘ └─────────┘  │
│                                     │
│  576                                │
│  litres filtered                    │
│                                     │
│  ┌────────────────┐ ┌────────────┐  │
│  │ 1,152          │ │ ≈46 kg     │  │
│  │ 500ml plastic  │ │ CO₂e       │  │
│  │ bottles avoided│ │ avoided*   │  │
│  └────────────────┘ └────────────┘  │
│                                     │
│  Estimated annual saving            │
│  KSh 16,000                         │
│  Based on KSh 150 per 20L refill    │
│                                     │
│  ✓ I filter with Ultra Clear        │
│                                     │
│  ★ 500–2,000 L Impact Level         │
│  ━━━━━░░░░░░░░░░░░░░░░░░░  5%     │
│  1,424 litres to the next milestone │
│                                     │
│  3% of Ultra Clear revenue supports │
│  clean-water access through         │
│  Hydrate the Future™                │
│                                     │
│  [ Share impact ]   [ View details ]│
└─────────────────────────────────────┘
```

## Increment logic

```ts
const increment = Number(litresSinceLastUpdate);

if (!Number.isFinite(increment) || increment <= 0) return;

const newTotalFilteredLitres =
  currentTotalFilteredLitres + increment;

await saveImpactUpdate({
  litresAdded: increment,
  totalFilteredLitres: newTotalFilteredLitres,
  recordedAt: new Date().toISOString(),
});

setTotalFilteredLitres(newTotalFilteredLitres);
setLitresSinceLastUpdate("");
```

Never replace the cumulative total with the input value.

## Bottle-equivalent logic

```ts
const BOTTLE_VOLUME_L = 0.5;

const bottleEquivalent =
  totalFilteredLitres / BOTTLE_VOLUME_L;
```

At 576 L:

```text
576 / 0.5 = 1,152 bottle equivalents
```

## CO₂e logic

Use the modification-guide baseline:

```text
576 L
1,152 x 500ml bottle equivalents
≈46 kg CO₂e avoided
```

This corresponds to a configurable demo factor:

```ts
const CO2E_PER_500ML_BOTTLE_KG = 0.03993056;
```

Calculation:

```ts
const co2eAvoidedKg =
  bottleEquivalent * CO2E_PER_500ML_BOTTLE_KG;
```

Keep the factor configurable and store its source metadata separately. Do not claim that GRI or TNFD supplied the conversion factor.

## CO₂e explanation

The CO₂e card is interactive. On tap, open:

> Estimated bottle-related emissions avoided. Calculated using a documented 500ml PET-bottle emissions factor. This is an estimate, not a carbon credit or verified offset.

Optional supporting line:

> The estimate changes automatically with your cumulative filtered litres.

## Savings

Keep the approved reference state:

```text
576 L -> KSh 16,000 estimated annual saving
Based on KSh 150 per 20L refill
```

For the demo only:

```ts
const REFERENCE_LITRES = 576;
const REFERENCE_ANNUAL_SAVING_KES = 16000;

const estimatedAnnualSavingKes =
  totalFilteredLitres <= 0
    ? 0
    : Math.round(
        (totalFilteredLitres / REFERENCE_LITRES) *
        REFERENCE_ANNUAL_SAVING_KES
      );
```

Production should replace this demo ratio with the app's real annualization logic using usage amount + measurement period + KSh 150/20L baseline.

## Milestones

```ts
const MILESTONES = [
  { min: 0, max: 500, label: "0–500 L" },
  { min: 500, max: 2000, label: "500–2,000 L" },
  { min: 2000, max: 5000, label: "2,000–5,000 L" },
  { min: 5000, max: 10000, label: "5,000–10,000 L" },
  { min: 10000, max: 50000, label: "10,000–50,000 L" },
];
```

At 576 L:

```text
500–2,000 L
5%
1,424 litres to the next milestone
```

Show only one active milestone.

## Trust statement

Keep exactly:

> ✓ I filter with Ultra Clear

## Hydrate the Future™

Add:

> 3% of Ultra Clear revenue supports clean-water access through Hydrate the Future™

Do not calculate a personal donation amount from litres.

## Recommended helper

```ts
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
```

## Input UX

Label:

```text
Add litres consumed
```

Placeholder:

```text
20 litres
```

Rules:

- accept numeric input;
- reject blank, zero and negative values;
- disable Add while persisting;
- do not clear the input until persistence succeeds;
- prevent double-submit;
- store each increment for auditability.

Success example:

```text
20 litres added to your impact.
```

## Shower-filter protection

For shower-only users, do not show:

- Add litres consumed;
- bottle-equivalent card;
- CO₂e bottle card;
- refill savings.

Keep shower impact as:

```text
[number] days used
for a healthy skin
```

## QA

Initial state:

```text
576 L
1,152 bottle equivalents
≈46 kg CO₂e
KSh 16,000
500–2,000 L
5%
1,424 L remaining
```

Add 20 L:

```text
596 L
1,192 bottle equivalents
≈47.6 kg CO₂e
KSh 16,556 demo saving
500–2,000 L
≈6%
1,404 L remaining
```

## Replit agent instruction

> Modify only the existing Ultra Clear Impact Card. Replace lifetime-total editing with an incremental **Add litres consumed** control. Each submitted amount represents consumption since the previous update and must be persisted as an individual impact update before being added to the cumulative filtered-litres total. Recalculate 500ml bottle equivalents, the configurable bottle-related CO₂e estimate, the demo annual-saving value, and milestone progress from the new cumulative total. Use the compact two-tile bottle/CO₂e layout, keep **“✓ I filter with Ultra Clear”**, add the **3% Hydrate the Future™** line, preserve a single conditional milestone, and make the CO₂e tile open the approved estimate disclaimer. Do not modify unrelated Companion App features.
