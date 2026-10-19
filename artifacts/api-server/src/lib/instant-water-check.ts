/**
 * The versioned, server-owned scorer for the public instant water check.
 *
 * Keep this module free of HTTP/database concerns.  The answer values and
 * rules are deliberately explicit: accepting arbitrary strings here would
 * make a result depend on client wording and would make a rules-version
 * migration impossible.
 */

export const INSTANT_WATER_CHECK_RULES_VERSION = "instant-water-check-v2" as const;

export const WATER_SOURCES = [
  "municipal",
  "borehole",
  "shallow",
  "vendor",
  "bottled",
  "rain",
] as const;
export type WaterSource = (typeof WATER_SOURCES)[number];

export const WATER_CONCERNS = [
  "scale",
  "taste",
  "cloudy",
  "skin",
  "safety",
  "cost",
] as const;
export type WaterConcern = (typeof WATER_CONCERNS)[number];

export const WATER_SYMPTOMS = ["none", "scale", "taste", "cloudy", "skin", "safety"] as const;
export type WaterSymptom = (typeof WATER_SYMPTOMS)[number];

export const WATER_USE_CONTEXTS = ["drinking", "cooking", "bathing", "mixed"] as const;
export type WaterUseContext = (typeof WATER_USE_CONTEXTS)[number];

export const WATER_SETTINGS = [
  "home",
  "rental",
  "salon",
  "office",
  "hospitality",
  "school",
  "resell",
] as const;
export type WaterSetting = (typeof WATER_SETTINGS)[number];

export const WATER_BANDS = ["Low", "Moderate", "High"] as const;
export type WaterBand = (typeof WATER_BANDS)[number];

export interface InstantWaterCheckAnswers {
  source: WaterSource;
  concern: WaterConcern;
  sources?: WaterSource[];
  concerns?: WaterConcern[];
  settings?: WaterSetting[];
  symptom?: WaterSymptom;
  useContext?: WaterUseContext;
  area: string;
  setting: WaterSetting;
}

export type InstantWaterCheckProvenance =
  | "general_indicative"
  | "reviewed_regional_guidance";

export interface InstantWaterCheckBands {
  hardness: WaterBand;
  taste: WaterBand;
  sediment: WaterBand;
  microbial: WaterBand;
}

export interface InstantWaterCheckResult {
  rulesVersion: typeof INSTANT_WATER_CHECK_RULES_VERSION;
  bands: InstantWaterCheckBands;
  /** Numeric values are useful to trusted callers, but should not be exposed
   * from the public-token endpoint as an alternate scoring contract. */
  levels: {
    hardness: 1 | 2 | 3;
    taste: 1 | 2 | 3;
    sediment: 1 | 2 | 3;
    microbial: 1 | 2 | 3;
  };
  areaFlags: {
    hardGroundwater: boolean;
    riftValleyFluoride: boolean;
  };
  summary: string;
  recommendation: {
    name: string;
    explanation: string;
    productId?: number;
    productName?: string;
    action?: "product" | "enquiry";
  };
  disclaimer: string;
  provenance: InstantWaterCheckProvenance;
}

const BASE: Record<
  WaterSource,
  InstantWaterCheckResult["levels"]
> = {
  municipal: { hardness: 2, taste: 3, sediment: 2, microbial: 1 },
  borehole: { hardness: 3, taste: 2, sediment: 2, microbial: 2 },
  shallow: { hardness: 2, taste: 2, sediment: 3, microbial: 3 },
  vendor: { hardness: 2, taste: 2, sediment: 3, microbial: 3 },
  bottled: { hardness: 1, taste: 1, sediment: 1, microbial: 1 },
  rain: { hardness: 1, taste: 2, sediment: 3, microbial: 2 },
};

const CONCERN_BUMP: Record<
  WaterConcern,
  Partial<Record<keyof InstantWaterCheckResult["levels"], 1>>
> = {
  scale: { hardness: 1 },
  taste: { taste: 1 },
  cloudy: { sediment: 1 },
  skin: { hardness: 1 },
  safety: { microbial: 1 },
  cost: {},
};

const SYMPTOM_BUMP: Record<WaterSymptom, Partial<Record<keyof InstantWaterCheckResult["levels"], 1>>> = {
  none: {},
  scale: { hardness: 1 },
  taste: { taste: 1 },
  cloudy: { sediment: 1 },
  skin: { hardness: 1 },
  safety: { microbial: 1 },
};

const HARD_AREAS = [
  "athi",
  "kitengela",
  "machakos",
  "kajiado",
  "makueni",
  "kitui",
  "ngong",
  "rongai",
  "mavoko",
  "isiolo",
  "garissa",
  "wajir",
  "mandera",
  "thika",
  "ruiru",
] as const;

const RIFT_AREAS = [
  "nakuru",
  "naivasha",
  "baringo",
  "kajiado",
  "eldoret",
  "nyahururu",
  "elementaita",
  "magadi",
  "suswa",
  "longonot",
] as const;

const REVIEWED_COUNTRIES = new Set([
  "ghana", "gh", "kenya", "ke", "tanzania", "tz", "rwanda", "rw",
  "nigeria", "ng", "uganda", "ug",
]);

// These are deliberately broad source-type cautions, not claims about a
// particular city or water utility. The reviewed country set only determines
// whether these conservative rules are applied; it never uses community
// ratings or other unreviewed local data.
const REVIEWED_SOURCE_BUMP: Partial<
  Record<WaterSource, Partial<Record<keyof InstantWaterCheckResult["levels"], 1>>>
> = {
  borehole: { hardness: 1 },
  shallow: { microbial: 1 },
};

const SOURCE_LABEL: Record<WaterSource, string> = {
  municipal: "piped municipal supply",
  borehole: "a borehole",
  shallow: "a shallow well or surface source",
  vendor: "a vendor or bowser",
  bottled: "bottled or sachet water",
  rain: "harvested rainwater",
};

function normalizeCountry(country: string): string {
  return country.trim().normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function hasArea(area: string, terms: readonly string[]): boolean {
  const normalized = area
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return terms.some((term) => normalized.includes(term));
}

function band(level: 1 | 2 | 3): WaterBand {
  return WATER_BANDS[level - 1];
}

function recommendation(
  levels: InstantWaterCheckResult["levels"],
  concern: WaterConcern,
  setting: WaterSetting,
): InstantWaterCheckResult["recommendation"] {
  if (setting === "resell") {
    return {
      name: "Distribution partnership",
      explanation:
        "You are buying to supply others, so the conversation is margin, volume and territory rather than a single unit.",
    };
  }
  if (setting === "salon") {
    return {
      name: "Shower & skin filtration",
      explanation:
        "Salons feel hard water early—in how hair takes colour and how clients' scalps react after a wash.",
    };
  }
  if (
    setting === "office" ||
    setting === "hospitality" ||
    setting === "school"
  ) {
    return {
      name: "Dispenser & commercial systems",
      explanation:
        "Shared premises need throughput and a predictable cartridge schedule, not a household unit.",
    };
  }
  if (concern === "skin") {
    return {
      name: "Shower & skin filtration",
      explanation:
        "Your concern is contact with water rather than drinking it, so the shower is where to start.",
    };
  }
  if (concern === "cost") {
    return {
      name: "Filter bottles & portable filtration",
      explanation:
        "A refillable filtered bottle replaces the weekly bottled-water spend rather than adding to it.",
    };
  }
  if (levels.microbial >= 3) {
    return {
      name: "Survivor-grade portable filtration",
      explanation:
        "Where the microbial band is high, the priority is point-of-use treatment you can rely on daily.",
    };
  }
  if (levels.hardness >= 3) {
    return {
      name: "Home & kitchen filtration",
      explanation:
        "Hard water is a whole-household problem. Treating it at the kitchen point-of-use is the usual first step.",
    };
  }
  if (levels.taste >= 3) {
    return {
      name: "Sweet Home faucet filtration",
      explanation:
        "Taste and odour respond quickly to point-of-use filtration at the tap you actually drink from.",
    };
  }
  return {
    name: "Home & kitchen filtration",
    explanation:
      "A general-purpose point-of-use setup is the sensible starting point for your profile.",
  };
}

export function scoreInstantWaterCheck(
  answers: InstantWaterCheckAnswers,
  country = "Kenya",
): InstantWaterCheckResult {
  answers = normalizeWaterSelections(answers);
  if (!WATER_SOURCES.includes(answers.source)) {
    throw new Error("Invalid water source");
  }
  if (!WATER_CONCERNS.includes(answers.concern)) {
    throw new Error("Invalid water concern");
  }
  if (answers.symptom !== undefined && !WATER_SYMPTOMS.includes(answers.symptom)) {
    throw new Error("Invalid water symptom");
  }
  if (answers.useContext !== undefined && !WATER_USE_CONTEXTS.includes(answers.useContext)) {
    throw new Error("Invalid water use context");
  }
  if (!WATER_SETTINGS.includes(answers.setting)) {
    throw new Error("Invalid water setting");
  }
  if (
    typeof answers.area !== "string" ||
    answers.area.trim().length < 1 ||
    answers.area.trim().length > 160
  ) {
    throw new Error("Invalid service area");
  }

  const sources = answers.sources!;
  const concerns = answers.concerns!;
  const settings = answers.settings!;
  const levels = { ...BASE[sources[0]] };
  for (const source of sources) {
    for (const key of Object.keys(levels) as (keyof typeof levels)[]) {
      levels[key] = Math.max(levels[key], BASE[source][key]) as 1 | 2 | 3;
    }
  }
  for (const concern of concerns) {
    for (const [key, increment] of Object.entries(CONCERN_BUMP[concern])) {
      const scoreKey = key as keyof typeof levels;
      levels[scoreKey] = Math.min(3, levels[scoreKey] + increment) as 1 | 2 | 3;
    }
  }
  if (answers.symptom && !concerns.includes(answers.symptom as WaterConcern)) {
    for (const [key, increment] of Object.entries(SYMPTOM_BUMP[answers.symptom])) {
      const scoreKey = key as keyof typeof levels;
      levels[scoreKey] = Math.min(3, levels[scoreKey] + increment) as 1 | 2 | 3;
    }
  }

  const reviewedRegionalGuidance = REVIEWED_COUNTRIES.has(normalizeCountry(country));
  if (reviewedRegionalGuidance) {
    for (const source of sources) {
    for (const [key, increment] of Object.entries(REVIEWED_SOURCE_BUMP[source] ?? {})) {
      const scoreKey = key as keyof typeof levels;
      levels[scoreKey] = Math.min(3, levels[scoreKey] + increment) as 1 | 2 | 3;
    }
    }
  }

  const normalizedCountry = normalizeCountry(country);
  const kenya = normalizedCountry === "kenya" || normalizedCountry === "ke";
  const hardGroundwater = kenya && hasArea(answers.area, HARD_AREAS);
  if (
    hardGroundwater &&
    (sources.includes("borehole") || sources.includes("municipal"))
  ) {
    levels.hardness = 3;
  }
  const riftValleyFluoride =
    kenya && sources.includes("borehole") && hasArea(answers.area, RIFT_AREAS);
  // Explicit precedence, independent of the order in which choices were tapped.
  const setting = (["resell", "salon", "office", "hospitality", "school", "home", "rental"] as const)
    .find(value => settings.includes(value))!;
  const concern = (["skin", "cost", "safety", "scale", "taste", "cloudy"] as const)
    .find(value => concerns.includes(value))!;
  const rec = recommendation(levels, concern, setting);

  return {
    rulesVersion: INSTANT_WATER_CHECK_RULES_VERSION,
    levels,
    bands: {
      hardness: band(levels.hardness),
      taste: band(levels.taste),
      sediment: band(levels.sediment),
      microbial: band(levels.microbial),
    },
    areaFlags: { hardGroundwater, riftValleyFluoride },
    // Keep this summary suitable for the redacted public-token response. The
    // area is retained in the assessment row for the owner/staff views, but a
    // bearer result token must not disclose location or contact details.
    summary: `Based on ${sources.map(source => SOURCE_LABEL[source]).join(", ")} and the answers provided.`,
    recommendation: rec,
    disclaimer: reviewedRegionalGuidance
      ? "This is an indicative profile using reviewed, broad country-level source guidance and your answers. It is not a laboratory analysis and is not a health assessment."
      : "This is an indicative profile using general source-type rules and your answers. It is not a laboratory analysis and is not a health assessment.",
    provenance: reviewedRegionalGuidance ? "reviewed_regional_guidance" : "general_indicative",
  };
}

/** Canonical arrays and stable scalar summaries for old consumers. Reject mixed
 * inputs whose scalar is not a selected value; do not silently discard choices. */
export function normalizeWaterSelections<T extends Partial<InstantWaterCheckAnswers>>(input: T): T & InstantWaterCheckAnswers {
  const output = { ...input };
  const groups = [
    ["source", "sources", WATER_SOURCES],
    ["concern", "concerns", WATER_CONCERNS],
    ["setting", "settings", WATER_SETTINGS],
  ] as const;
  for (const [scalar, plural, allowed] of groups) {
    const legacy = input[scalar];
    const selected = input[plural] ?? (legacy === undefined ? [] : [legacy]);
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > 3 ||
        new Set(selected).size !== selected.length ||
        selected.some(value => !(allowed as readonly unknown[]).includes(value)) ||
        (legacy !== undefined && !selected.includes(legacy as never))) {
      throw new Error(`Invalid water ${scalar}: INVALID_SELECTIONS`);
    }
    const canonical = allowed.filter(value => selected.includes(value as never));
    Object.assign(output, { [plural]: canonical, [scalar]: canonical[0] });
  }
  return output as T & InstantWaterCheckAnswers;
}

/** Alias retained for callers that make the version explicit. */
export const scoreInstantWaterCheckV1 = scoreInstantWaterCheck;

export const instantWaterCheckDisclaimer =
  "This is an indicative profile using general source-type rules and your answers. It is not a laboratory analysis and is not a health assessment.";