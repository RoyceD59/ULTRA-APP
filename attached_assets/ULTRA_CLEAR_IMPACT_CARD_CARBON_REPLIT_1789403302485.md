# Ultra Clear Companion App — Impact Card Carbon + Plastic Upgrade

**Version:** 1.1  
**Scope:** Impact Card only  
**Target:** Existing Ultra Clear Companion App in Replit  
**Do not modify:** unrelated navigation, authentication, checkout, product registration, rewards, orders or support features.

---

## 1. Objective

Upgrade the approved Ultra Clear Impact Card so a drinking-water filtration user can see:

1. Litres filtered.
2. Equivalent number of disposable **500 ml PET bottles avoided**.
3. Estimated **kilograms of PET plastic avoided**.
4. Estimated **kilograms of CO₂e associated with virgin PET production avoided**.
5. Existing annual savings, trust statement and conditional litre milestone.

For shower-only users, continue to hide all drinking-water, plastic-bottle, plastic-mass, CO₂e-from-bottle and refill-savings comparisons. Shower-only users continue to see days used and **“for a healthy skin.”**

---

## 2. Important reporting language

Do **not** label the customer result as:

- “GRI certified”
- “TNFD certified”
- “verified carbon saving”
- “carbon credit”
- “offset”
- “net zero contribution”

Use:

> **Estimated PET production footprint avoided**

and:

> **Methodology-aligned estimate**

This card is a customer impact estimate. It can feed corporate ESG records, but it is not by itself a formal GRI or TNFD disclosure.

---

## 3. Standards logic

### GRI

Use the calculation architecture to support:

- **GRI 305-5 — Reduction of GHG emissions:** requires reductions to be reported in CO₂e with baseline, scope, standards/methodology and assumptions documented.
- **GRI 306-2 — Management of significant waste-related impacts:** recognises actions and circularity measures that prevent waste generation and requires processes for collecting and monitoring waste-related data.
- **GRI 306 waste-prevention guidance:** waste prevented may be calculated as the reduction in waste generation resulting from prevention actions.

### TNFD

Use the plastic mass record as an input toward:

- **TNFD core global metric C2.3 — Plastic pollution:** plastic footprint measured by total weight of plastics used/sold, with raw-material-content information.
- TNFD treats climate change and pollution/plastic pollution as separate but connected drivers of nature change.

Do not claim TNFD alignment solely because the card displays a number. Corporate reporting must still apply TNFD's wider materiality, governance, location and disclosure requirements.

---

## 4. Carbon conversion source

For the demo, use the current 2026 UK Department for Energy Security and Net Zero (DESNZ) company-reporting material-use factor:

```ts
PET_CO2E_FACTOR_KG_PER_KG = 3.86158251;
```

Equivalent to:

```text
3,861.58251 kg CO₂e / tonne PET
```

Material basis:

```text
Plastics: PET (including forming)
Primary / virgin material production
```

This factor is used here as an activity-based material-production proxy. It is not supplied by GRI or TNFD.

---

## 5. 500 ml bottle-weight assumption

Use a **configurable** bottle-weight assumption.

Initial demo/default:

```ts
PET_BOTTLE_WEIGHT_G = 13.3;
```

Reason: 13.3 g is the conservative lower end of a documented range for standard 500 ml PET water bottles.

Before Ultra Clear uses this number in an externally assured ESG report, replace this default with a Kenya-specific measured benchmark from a documented sample of representative 500 ml disposable water bottles.

The app must never bury this assumption.

---

## 6. Calculation

```ts
const BOTTLE_VOLUME_L = 0.5;
const PET_BOTTLE_WEIGHT_G = 13.3;
const PET_CO2E_FACTOR_KG_PER_KG = 3.86158251;

const bottleEquivalent = filteredLitres / BOTTLE_VOLUME_L;

const plasticAvoidedKg =
  (bottleEquivalent * PET_BOTTLE_WEIGHT_G) / 1000;

const carbonAvoidedKgCo2e =
  plasticAvoidedKg * PET_CO2E_FACTOR_KG_PER_KG;
```

### Demo at 576 litres

```text
Filtered water              = 576 L
500 ml bottle equivalents   = 1,152
PET bottle mass assumption  = 13.3 g
Estimated PET avoided       = 15.3 kg
PET factor                  = 3.86158251 kg CO₂e/kg
Estimated footprint avoided = 59.2 kg CO₂e
```

Display the result as:

> **59.2 kg CO₂e**  
> estimated PET production footprint avoided

Do not round internal calculations before the final display.

---

## 7. What the carbon number includes

The v1.1 estimate represents the embodied/material-production footprint of the PET bottle material using the selected virgin PET material-use factor.

### Included

- PET raw-material production.
- PET forming as represented in the source factor.

### Excluded in v1.1

- Bottle cap.
- Label.
- Secondary packaging.
- Water treatment/bottling energy.
- Cold storage/refrigeration.
- Transport/distribution.
- Retail operations.
- Consumer travel.
- End-of-life treatment.
- Any emissions created by the Ultra Clear filter product itself.

Therefore the UI must say **“estimated PET production footprint avoided”**, not “total carbon footprint avoided”.

A later lifecycle model may add the missing elements, but do not mix them into v1.1 without a documented methodology update.

---

## 8. Final drinking-filter visual hierarchy

Maintain the current Impact Card language and hierarchy.

```text
YOUR ULTRA CLEAR IMPACT

576 litres
filtered

1,152
disposable 500ml plastic bottles avoided

15.3 kg                     59.2 kg CO₂e
estimated PET               estimated PET production
plastic avoided             footprint avoided

✓ I filter with Ultra Clear
```

Carbon and plastic mass should be shown as **two compact secondary evidence tiles**, not as additional badges.

The hierarchy remains:

1. litres filtered;
2. bottle equivalent;
3. plastic + carbon evidence;
4. trust identity;
5. savings;
6. milestone.

Do not let the ESG metrics visually overpower litres filtered.

---

## 9. “How we calculate” disclosure

Add a small expandable element directly below the impact card:

```text
How this environmental estimate is calculated
```

Expanded content:

```text
This is a methodology-aligned estimate, not a certification.

500ml bottle equivalent = filtered litres ÷ 0.5L.
Default PET bottle mass = 13.3g per bottle.
Plastic avoided = bottle equivalents × bottle mass.
CO₂e = PET mass × 3.86158251 kg CO₂e/kg PET.

Factor basis: 2026 DESNZ material-use factor for virgin PET including forming.

Excluded from this estimate: caps, labels, distribution,
bottling energy, refrigeration and end-of-life.
```

Do not place GRI or TNFD logos on the customer card.

---

## 10. Recommended data model

```ts
type ImpactMethodology = {
  methodologyVersion: "UC-IMPACT-PET-CO2E-v1.1";
  bottleEquivalentMl: 500;
  petBottleWeightG: number;
  petBottleWeightBasis: string;
  petEmissionFactorKgCo2ePerKg: number;
  emissionFactorSource: string;
  emissionFactorYear: number;
};

type DrinkingImpact = {
  filteredLitres: number;
  bottleEquivalentCount: number;
  plasticAvoidedKg: number;
  carbonAvoidedKgCo2e: number;
  calculatedAt: string;
  methodology: ImpactMethodology;
};
```

Recommended stored metadata:

```ts
const IMPACT_METHOD = {
  methodologyVersion: "UC-IMPACT-PET-CO2E-v1.1",
  bottleEquivalentMl: 500,
  petBottleWeightG: 13.3,
  petBottleWeightBasis:
    "Conservative demo default; replace with documented Kenya bottle sample average",
  petEmissionFactorKgCo2ePerKg: 3.86158251,
  emissionFactorSource:
    "UK DESNZ Greenhouse Gas Conversion Factors 2026 — PET incl. forming, primary material production",
  emissionFactorYear: 2026,
};
```

---

## 11. React helper

Create a single reusable calculator.

```ts
export const IMPACT_METHOD = {
  bottleVolumeLitres: 0.5,
  petBottleWeightG: 13.3,
  petCo2eFactorKgPerKg: 3.86158251,
} as const;

export function calculateDrinkingImpact(filteredLitres: number) {
  const safeLitres = Math.max(filteredLitres ?? 0, 0);

  const bottleEquivalent =
    safeLitres / IMPACT_METHOD.bottleVolumeLitres;

  const plasticAvoidedKg =
    (bottleEquivalent * IMPACT_METHOD.petBottleWeightG) / 1000;

  const carbonAvoidedKgCo2e =
    plasticAvoidedKg * IMPACT_METHOD.petCo2eFactorKgPerKg;

  return {
    filteredLitres: safeLitres,
    bottleEquivalent,
    plasticAvoidedKg,
    carbonAvoidedKgCo2e,
  };
}
```

Formatting:

```ts
const impact = calculateDrinkingImpact(userImpact.filteredLitres);

const bottlesDisplay =
  Math.round(impact.bottleEquivalent).toLocaleString();

const plasticDisplay =
  `${impact.plasticAvoidedKg.toFixed(1)} kg`;

const carbonDisplay =
  `${impact.carbonAvoidedKgCo2e.toFixed(1)} kg CO₂e`;
```

---

## 12. Component addition

Add below the existing bottle-equivalent line:

```tsx
<div className="environmentEvidenceGrid">
  <div className="evidenceTile">
    <strong>{plasticDisplay}</strong>
    <span>estimated PET plastic avoided</span>
  </div>

  <div className="evidenceTile evidenceTileCarbon">
    <strong>{carbonDisplay}</strong>
    <span>estimated PET production footprint avoided</span>
  </div>
</div>
```

Do not render for shower-only users.

```tsx
{activeProductType === "drinking" && (
  <EnvironmentalEvidence
    plasticAvoidedKg={impact.plasticAvoidedKg}
    carbonAvoidedKgCo2e={impact.carbonAvoidedKgCo2e}
  />
)}
```

---

## 13. ESG aggregation readiness

The user-facing card is one level of the data model. Preserve enough fields to aggregate later:

```text
user_id
product_id
product_type
filtered_litres
bottle_equivalent_count
plastic_avoided_kg
carbon_avoided_kg_co2e
calculation_methodology_version
bottle_weight_g
emission_factor
emission_factor_year
calculated_at
```

For company ESG reporting, aggregate verified records separately from customer-facing display values.

Never sum records twice when a user owns multiple drinking filters.

---

## 14. QA checks

Replit agent must verify:

- 576 L => 1,152 bottle equivalents.
- 576 L => 15.3 kg estimated PET avoided using 13.3 g/bottle.
- 576 L => 59.2 kg CO₂e estimated PET production footprint avoided.
- Changing litres updates all four metrics from one source.
- Shower-only mode shows none of the PET/carbon metrics.
- The methodology disclosure opens and closes.
- No GRI/TNFD certification claims are displayed.
- Existing milestone bands remain unchanged:
  - 0–500 L
  - 500–2,000 L
  - 2,000–5,000 L
  - 5,000–10,000 L
  - 10,000–50,000 L
- At 576 L: milestone remains 500–2,000 L; 1,424 L remain; progress rounds to 5%.

---

## 15. Source register

1. Global Reporting Initiative — GRI 305: Emissions; Disclosure 305-5.
2. Global Reporting Initiative — GRI 306: Waste; waste prevention and monitoring.
3. Taskforce on Nature-related Financial Disclosures — Recommendations; core global metric C2.3 Plastic pollution.
4. UK Department for Energy Security and Net Zero — Greenhouse Gas Conversion Factors 2026.
5. NIH Environmental Management System — lifecycle discussion of a standard 500 ml PET water bottle and documented bottle-weight range.

---

## 16. Replit agent instruction

**Implement only this Impact Card enhancement. Do not restructure the rest of the Companion App. Use the existing filtered-litres source as the single source of truth. Add PET mass and carbon evidence as secondary tiles, add the methodology disclosure, preserve the existing trust language and milestone logic, and retain product-specific conditional rendering. The carbon value must be labeled as an estimate of PET production footprint avoided and must never be presented as a carbon credit, offset, GRI certification or TNFD certification.**
