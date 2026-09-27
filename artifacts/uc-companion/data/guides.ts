/**
 * Ultra Clear Companion — in-app guide articles.
 * Static structured content; works fully offline.
 * Categories: Installation | Filter Replacement | Troubleshooting | FAQ
 */

export type GuideStep = string; // plain text step

export interface GuideMedia {
  id: string;
  kind: 'image' | 'animation' | 'video';
  url: string;
  mimeType: string;
  altText: string;
  caption?: string | null;
  posterUrl?: string | null;
  byteSize?: number | null;
  durationSeconds?: number | null;
  animated?: boolean;
}

export interface GuideSection {
  heading: string;
  body?: string;           // prose paragraph
  steps?: GuideStep[];     // numbered steps (rendered as 1. 2. 3. …)
  tip?: string;            // highlighted callout box
  warning?: string;        // red warning callout
  illustrationIcon?: string; // Ionicons name for the section illustration banner
  media?: GuideMedia[];
}

export type GuideCategory =
  | 'Installation'
  | 'Filter Replacement'
  | 'Troubleshooting'
  | 'FAQ';

export interface Guide {
  id: string;
  title: string;
  summary: string;
  products: string;        // product name(s) for subtitle
  category: GuideCategory;
  icon: string;            // Ionicons name
  readTime: string;
  sections: GuideSection[];
  version?: number;
  updatedAt?: string;
}

export const GUIDES: Guide[] = [

  // ── INSTALLATION ────────────────────────────────────────────────────────────

  {
    id: 'bottle-setup',
    title: 'Getting started with your filter bottle',
    summary: 'Unbox, prime, and start drinking certified clean water in under 5 minutes.',
    products: 'Hydra Flux · Truva Go · Viva Drop · Flex · Timbo · Gym Buddy · Breeze',
    category: 'Installation',
    icon: 'water-outline',
    readTime: '5 min read',
    sections: [
      {
        heading: "What's in the box",
        body: 'Your Ultra Clear filter bottle ships with the bottle body, one Ahlstrom Disruptor® filter cartridge pre-installed, a lid or cap, and a warranty card. The Survivor Straw also includes a cleaning tool.',
      },
      {
        heading: 'Before your first use',
        tip: 'Always prime the filter before drinking. An unprimed filter can give water a slightly papery taste.',
        steps: [
          'Remove the bottle from its packaging and take out any protective inserts.',
          'Unscrew the lid and check that the filter cartridge is fully seated — push it down gently until you feel it click or seat firmly.',
          'Fill the bottle with clean tap water to the top.',
          'Screw the lid on and squeeze or press the bottle gently over a sink. The first 2–3 squeezes will push air through the filter — the water that comes out may look slightly cloudy. This is normal.',
          'Discard the first two full bottles of filtered water (or flush 150 ml each time by squeezing).',
          'Refill, drink, and enjoy certified clean water.',
        ],
      },
      {
        heading: 'Daily use',
        steps: [
          'Fill with tap, borehole, or surface water.',
          'Drink directly through the mouthpiece (Hydra Flux, Truva Go, Viva Drop, Timbo, Gym Buddy) or squeeze through the straw / nozzle (Flex, Breeze).',
          'The Ahlstrom Disruptor® filter removes >99.9% of bacteria and protozoa as water passes through it. No waiting — filtration is instant.',
          'Keep the mouthpiece cap closed when not in use to prevent contamination.',
        ],
      },
      {
        heading: 'Cleaning the bottle body',
        steps: [
          'Remove the filter cartridge before washing. The cartridge must not go in a dishwasher.',
          'Wash the bottle body and lid with warm water and mild dish soap.',
          'Rinse thoroughly — no soap residue should remain.',
          'Air-dry upside down before re-inserting the cartridge.',
        ],
        tip: 'Do not use bleach, abrasive pads, or harsh detergents. These can damage the BPA-free plastic and void your SGS certification.',
      },
      {
        heading: 'Storage',
        body: 'If you will not use the bottle for more than 2 weeks, remove the filter cartridge, rinse it with clean water, and store it in a sealed zip-lock bag in the refrigerator. This prevents the filter medium from drying out and cracking. Dry storage can reduce filter life.',
      },
    ],
  },

  {
    id: 'sweet-home-install',
    title: 'Sweet Home Faucet Filter — installation guide',
    summary: 'Clip your kitchen tap filter on in under 5 minutes — no tools, no plumber.',
    products: 'Sweet Home',
    category: 'Installation',
    icon: 'home-outline',
    readTime: '5 min read',
    sections: [
      {
        heading: 'Before you start',
        body: 'The Sweet Home attaches to the aerator thread on the end of your kitchen tap. It fits most standard taps (external thread 22 mm male or 24 mm female). Check the adaptor kit included in the box — four adaptors cover most Kenyan tap types.',
        tip: 'Not sure which adaptor to use? Match the shape of your current aerator to the diagrams on the Quick-Start card inside the box.',
      },
      {
        heading: 'Tools required',
        body: 'None. The Sweet Home is designed for tool-free installation. You may use a cloth to protect the tap finish when hand-tightening.',
      },
      {
        heading: 'Installation steps',
        steps: [
          'Turn off the tap fully.',
          'Unscrew the existing aerator or mesh screen from the tap spout by turning it anticlockwise. If it is tight, use a cloth for grip — do not use pliers, which can scratch the finish.',
          'Select the correct adaptor from the kit and hand-thread it onto the tap spout. Clockwise = tighten.',
          'Align the Sweet Home housing with the adaptor and press upward until you feel it click into the bracket.',
          'Turn on the tap slowly. Check for any leaks at the connection. If you see dripping, turn off the tap, remove the unit, and reseat the adaptor — ensure the rubber O-ring is correctly positioned.',
          'Let the water run for 30 seconds to flush air from the new filter.',
          'Select "Filtered" mode by turning the diverter lever to the filter position (marked with the drop icon). The first 1–2 litres bypass the filter automatically to flush manufacturing residue — then you are certified clean.',
        ],
      },
      {
        heading: 'Switching between filtered and unfiltered',
        body: 'The Sweet Home has a built-in diverter that lets you switch between filtered drinking water and full-pressure unfiltered water (for washing dishes or filling a pot). Filtered mode is lower-pressure — this is normal. The filter removes particles and chlorine and this takes slightly more time.',
      },
      {
        heading: 'First week tips',
        steps: [
          'Use the filtered side for all drinking water and cooking.',
          'Use the unfiltered side for dishwashing, rinsing vegetables, and boiling water.',
          'Track your filter life in the Ultra Clear app under "My Filter" — the app will remind you when replacement is due.',
        ],
        warning: 'Do not use the Sweet Home with hot water above 38 °C. Hot water can degrade the filter medium and reduce performance. Always run the tap cold before switching to filtered mode.',
      },
    ],
  },

  {
    id: 'shower-filter-install',
    title: 'Shower filter installation & cartridge swap',
    summary: 'Fit your shower filter in minutes and enjoy SGS-certified chlorine-free water every shower.',
    products: "J'adore · Derma Care · Pure Drop",
    category: 'Installation',
    icon: 'sparkles-outline',
    readTime: '4 min read',
    sections: [
      {
        heading: 'What you need',
        body: "Your filter housing, the pre-installed filter cartridge, and a small cloth. The J'adore, Derma Care, and Pure Drop all use a universal shower-head thread (1/2 inch BSP) that fits 99% of Kenyan shower arms.",
      },
      {
        heading: 'Installation',
        steps: [
          'Turn off the shower water supply or ensure the mixer tap is fully closed.',
          'Unscrew your existing shower head from the shower arm (the pipe coming out of the wall). Turn anticlockwise.',
          'Check the thread on the shower arm. Wrap 2–3 turns of PTFE (plumber\'s) tape clockwise around the arm thread to create a watertight seal — the tape is included in the box.',
          'Hand-thread the filter housing inlet onto the shower arm. Tighten firmly by hand — one extra quarter-turn with a cloth for grip is sufficient. Do not overtighten.',
          'Reattach your existing shower head to the outlet end of the filter housing. The outlet thread matches the standard shower arm spec.',
          'Turn on the water slowly and check for leaks at both connections.',
          'Run the shower for 60 seconds on full flow to flush the new cartridge.',
        ],
        tip: "For the Channel facial basin filter: the installation is identical but connects between the tap spout and basin aerator, the same way as the Sweet Home. See the Sweet Home guide if you need adaptor help.",
      },
      {
        heading: 'What the filter removes',
        body: 'The multi-layer media (PP Cotton → KDF → Activated Carbon → Vitamin C) removes >95% of free chlorine, reduces heavy metals, and neutralises residual chloramines. This is the primary cause of dry skin, brittle hair, and irritated scalp in Nairobi mains water.',
      },
      {
        heading: 'Maintenance',
        body: 'No daily maintenance is required. The filter is self-contained. Every 5 months (or when you notice a reduction in water pressure through the filter), replace the cartridge. See the Filter Replacement guide.',
      },
    ],
  },

  {
    id: 'ecosmart-elite-setup',
    title: 'EcoSmart Elite — setup, solar charging & pump care',
    summary: 'Full setup guide for the solar-powered certified filter with built-in power bank.',
    products: 'EcoSmart Elite',
    category: 'Installation',
    icon: 'flash-outline',
    readTime: '6 min read',
    sections: [
      {
        heading: 'In the box',
        body: 'EcoSmart Elite unit, USB-C charging cable, shoulder strap, cleaning brush, and Quick-Start guide.',
      },
      {
        heading: 'First charge',
        steps: [
          'Connect the USB-C cable to the charging port on the unit body and a wall adapter (5V 2A or higher). A full charge from flat takes approximately 3–4 hours.',
          'The LED indicator shows charge level: red = below 20%, amber = 20–80%, green = above 80%.',
          'Alternatively, position the unit with the solar panel facing direct sunlight. Full solar charge takes 6–8 hours in Nairobi direct sun. Partial overcast extends this to 10–12 hours.',
          'The built-in 4,000 mAh power bank can charge a smartphone while the unit is in use — connect via the USB-A output port.',
        ],
      },
      {
        heading: 'First use',
        steps: [
          'Ensure the filter assembly is fully screwed into the base — turn clockwise until firm.',
          'Fill the upper reservoir with water from any source (tap, borehole, river, or rainwater).',
          'Press the power button once. The pump will draw water through the four-stage filter (Nylon Mesh → UF Membrane 0.01 µm → Ahlstrom Disruptor® → Carbon Block) into the lower output chamber.',
          'Discard the first 200 ml — this flushes air and manufacturing residue.',
          'The output chamber fills in approximately 60–90 seconds per 400 ml. Drink directly from the output spout or pour into a cup.',
        ],
        tip: 'In field conditions with heavily turbid water (e.g. river water), the Nylon Mesh pre-filter will clog faster. Rinse the mesh under running water before each use to extend the inner filter life.',
      },
      {
        heading: 'Using as a power bank',
        steps: [
          'With the unit charged, connect your phone to the USB-A port.',
          'Press the power button twice quickly to activate power-bank mode (the pump will not run in this mode).',
          'The LED indicator shows remaining charge. One charge provides approximately 1 full smartphone charge.',
        ],
      },
      {
        heading: 'Cleaning & storage',
        steps: [
          'Empty the reservoirs fully after each use.',
          'Use the included brush to clean the Nylon Mesh pre-filter.',
          'Run 200 ml of clean water through the unit to flush the inner filter.',
          'Store upright with all ports closed. Do not store with water in the reservoirs for more than 48 hours.',
          'Filter life: 400 litres or 4 months, whichever comes first.',
        ],
      },
    ],
  },

  {
    id: 'survivor-straw-guide',
    title: 'Survivor Straw — field use & maintenance',
    summary: 'Drink safely from any water source: rivers, streams, boreholes, or emergency supplies.',
    products: 'Survivor Straw',
    category: 'Installation',
    icon: 'funnel-outline',
    readTime: '4 min read',
    sections: [
      {
        heading: 'How the Survivor Straw works',
        body: 'The Survivor Straw contains a compressed filtration block that removes >99.9% of bacteria (E. coli, Salmonella, Vibrio cholerae) and protozoa (Giardia, Cryptosporidium) as water is drawn through it by suction. It does not remove dissolved chemicals, heavy metals, or viruses — in those conditions, combine with water purification tablets.',
      },
      {
        heading: 'First use',
        steps: [
          'Remove the cap from both ends of the straw.',
          'Submerge the bottom end (inlet) in the water source.',
          'Sip firmly through the top end. The first 2–3 sips require stronger suction to wet the filter medium — this is normal.',
          'Continue drinking normally. The filter works continuously as long as you draw through it.',
        ],
        tip: 'For the very first use, suck vigorously for 5 seconds, then release. Repeat 2–3 times. You will feel resistance drop as the filter primes.',
      },
      {
        heading: 'Backflushing (cleaning)',
        steps: [
          'After each use, blow air back through the mouthpiece end firmly — 3–4 short sharp puffs.',
          'You will see dirty water exit from the inlet end. This is the filter ejecting captured particles.',
          'Repeat until the expelled water runs clear.',
          'Replace both caps and store the straw upright in your pack.',
        ],
        warning: 'Never store the Survivor Straw in a sealed bag while wet for more than 24 hours — this can encourage mould growth on the filter medium. Allow to air-dry first.',
      },
      {
        heading: 'When to replace',
        body: 'The filter is rated for 300 litres or 3 months of use. Replace it when: (1) you cannot draw water through it even after backflushing, (2) you have reached the 300L mark, or (3) 3 months have passed since first use. Use the Survivor Straw Cartridge replacement (SKU: UC-BOG-FCS-017).',
      },
      {
        heading: 'Field storage',
        steps: [
          'Always cap both ends when not in use.',
          'Store in a cool dry location away from direct sunlight.',
          'Do not freeze a wet filter — freezing ruptures the filter medium and destroys certification.',
          'Carry a spare cartridge on multi-day expeditions.',
        ],
      },
    ],
  },

  // ── FILTER REPLACEMENT ───────────────────────────────────────────────────────

  {
    id: 'bottle-cartridge-swap',
    title: 'How to replace your bottle filter cartridge',
    summary: 'Keep your certification active — swap the Ahlstrom Disruptor® cartridge every 150L or 3 months.',
    products: 'Hydra Flux · Truva Go · Viva Drop · Flex · Timbo · Gym Buddy · Breeze',
    category: 'Filter Replacement',
    icon: 'refresh-outline',
    readTime: '3 min read',
    sections: [
      {
        heading: 'When to replace',
        body: 'Your bottle cartridge should be replaced every 150 litres of filtered water or every 3 months — whichever comes first. Signs that replacement is due: noticeably slower flow through the mouthpiece, change in taste, or the Ultra Clear app filter tracker showing a replacement reminder.',
      },
      {
        heading: 'Getting the right cartridge',
        body: 'Use the Genuine Ahlstrom Disruptor® Bottle Filter Cartridge (SKU: UC-RPL-BTL-010). This cartridge fits all Ultra Clear bottle models. Third-party cartridges are not SGS-certified and may not remove pathogens to the same standard.',
      },
      {
        heading: 'Replacement steps',
        steps: [
          'Empty any remaining water from the bottle.',
          'Unscrew the lid fully and set aside.',
          'Grip the top of the cartridge and pull straight upward. It will release with a slight resistance — normal.',
          'Dispose of the old cartridge. It is safe for general waste.',
          'Unwrap the new cartridge and check that the rubber gasket (O-ring) is in place at the top.',
          'Insert the new cartridge into the bottle base, aligning the tabs. Press down firmly until you feel or hear it seat.',
          'Fill the bottle with water, screw on the lid, and flush 2 full bottles as described in the Getting Started guide.',
        ],
        tip: 'Replacing in the morning? Fill the bottle the night before and leave it standing — the cartridge self-primes overnight and water will flow freely from the first sip.',
      },
      {
        heading: 'Update your filter tracker',
        body: 'After replacing, open the Ultra Clear app → Account tab → My Filter → tap "Replaced today". The app will reset your usage clock and remind you when your next replacement is due.',
      },
    ],
  },

  {
    id: 'sweet-home-cartridge',
    title: 'Sweet Home — faucet cartridge replacement',
    summary: 'Keep your tap water certified — replace the cartridge every 4–5 months.',
    products: 'Sweet Home',
    category: 'Filter Replacement',
    icon: 'home-outline',
    readTime: '3 min read',
    sections: [
      {
        heading: 'When to replace',
        body: 'Replace every 4–5 months or approximately 1,500–2,000 litres of filtered water. Signs: significantly reduced water pressure from the filter tap, change in taste, or a filter alert in the app.',
      },
      {
        heading: 'Getting the right cartridge',
        body: 'Use the Genuine Faucet Filter Cartridge (SKU: UC-RPL-FCT-014). This is the only cartridge that maintains SGS certification on the Sweet Home.',
      },
      {
        heading: 'Replacement steps',
        steps: [
          'Turn off the tap.',
          'Twist the filter housing anticlockwise (looking from below) to unscrew it from the mount. The housing unscrews separately from the adaptor — the adaptor stays on the tap.',
          'Pull the spent cartridge out of the housing. It will slide straight out.',
          'Rinse the inside of the housing briefly with tap water.',
          'Insert the new cartridge — there is a directional arrow on the cartridge; it must point toward the outlet (down, toward the tap spout).',
          'Screw the housing back onto the mount clockwise until snug. Do not overtighten.',
          'Turn on the tap and run filtered water for 30 seconds to flush.',
        ],
        tip: 'Keep your packaging — the old cartridge fits neatly back in the new cartridge box for clean disposal.',
      },
      {
        heading: 'Update your app',
        body: 'Open the Ultra Clear app → Account → My Filter → tap "Replaced today" to reset the timer.',
      },
    ],
  },

  {
    id: 'shower-cartridge-swap',
    title: 'Shower & basin filter cartridge replacement',
    summary: 'Fresh certified chlorine removal every 5 months — a 2-minute swap.',
    products: "J'adore · Derma Care · Pure Drop · Channel · Derma Flux",
    category: 'Filter Replacement',
    icon: 'sparkles-outline',
    readTime: '3 min read',
    sections: [
      {
        heading: 'When to replace',
        body: "Replace every 5 months (J'adore, Derma Care, Pure Drop, Channel) or every 4–5 months (Derma Flux). Signs: reduced flow, change in water feel, or an app reminder. The Derma Flux has a perspective window — replace when the cartridge colour shifts from white to dark grey/brown.",
      },
      {
        heading: 'Replacement steps',
        steps: [
          'Turn off the shower or basin tap.',
          'Unscrew the filter housing from the shower arm or tap (anticlockwise).',
          'Open the housing by unscrewing the two halves.',
          'Remove the old cartridge and rinse the housing halves under running water.',
          'Insert the new cartridge, ensuring the directional arrow (if present) faces toward the outlet.',
          'Reassemble the housing — tighten until you feel resistance, then a quarter-turn more.',
          'Reinstall on the shower arm or tap and run water for 30 seconds.',
        ],
      },
      {
        heading: 'Cartridge reference',
        body: "J'adore / Derma Care / Pure Drop / Channel: Shower Filter Cartridge (UC-RPL-SHW-018).\nDerma Flux: Derma Flux Cartridge (UC-SKW-DFO-025).",
      },
    ],
  },

  // ── TROUBLESHOOTING ─────────────────────────────────────────────────────────

  {
    id: 'slow-flow-taste',
    title: 'Troubleshooting: slow flow or unusual taste',
    summary: 'Fix the most common filter issues in a few steps — no technician needed.',
    products: 'All Filters',
    category: 'Troubleshooting',
    icon: 'warning-outline',
    readTime: '4 min read',
    sections: [
      {
        heading: 'Slow or no flow — bottle filters',
        steps: [
          'Check that the cartridge is fully seated. Remove and reinsert with firm downward pressure.',
          'Check for an airlock: unscrew the lid slightly (do not remove), squeeze the bottle once, then tighten the lid. This breaks the vacuum and restores flow.',
          'If you have not primed the filter: fill the bottle, invert it, and let water drain through the mouthpiece for 10–15 seconds without squeezing.',
          'If the filter is more than 3 months old or you have used more than 150 litres: replace the cartridge.',
        ],
        tip: 'Borehole water or surface water with high turbidity (sediment) can clog filters faster. Pre-filter turbid water through a clean cloth before filling your bottle.',
      },
      {
        heading: 'Slow flow — faucet & shower filters',
        steps: [
          'Disconnect the filter and check that no debris is blocking the inlet mesh. Clean with a soft brush under running water.',
          'If the filter is close to its replacement date, replace the cartridge.',
          'For the Sweet Home: check that the diverter is fully in "Filtered" mode — a half-position can restrict flow.',
          'If your mains water pressure is low (common in some Nairobi estates), this can reduce filtered flow. This is not a defect.',
        ],
      },
      {
        heading: 'Unusual taste or smell',
        body: 'A slight earthy or papery taste in the first 1–2 uses is normal — this is residual carbon dust from the filter medium. It is harmless and disappears after flushing.',
        steps: [
          'Flush the filter with 2–3 full bottles of water, discarding the output.',
          'Chlorine taste after filtering: run the tap for 15–20 seconds before filtering. If the chlorine taste persists, the filter cartridge may be near the end of its life.',
          'Musty or mouldy smell: this can occur if the filter has been left wet in a sealed container for more than 48 hours. Flush thoroughly; if the smell persists, replace the cartridge.',
          'Metallic taste: unusual in Ultra Clear systems — contact support. It may indicate high heavy metals in your water source; a water test is recommended.',
        ],
      },
      {
        heading: 'Leaking at connections',
        steps: [
          'Faucet or shower filter: turn off water and reseat the connection. Check that the rubber O-ring is in place and not pinched or missing.',
          'Apply 2 extra turns of PTFE tape to the thread and reconnect.',
          'Bottle: check that the lid O-ring is clean and not cracked. Replace the lid if the O-ring is damaged.',
        ],
      },
      {
        heading: 'Still having issues?',
        body: 'Submit a maintenance ticket from the Maintenance Tickets tab in this app, or call us on 0717774049. Our certified technicians are available Mon–Sat 8am–6pm.',
      },
    ],
  },

  // ── FAQ ─────────────────────────────────────────────────────────────────────

  {
    id: 'kenya-water-faq',
    title: 'Kenya water quality FAQ',
    summary: 'Everything you need to know about Nairobi water, borehole safety, and what Ultra Clear removes.',
    products: 'All Products',
    category: 'FAQ',
    icon: 'flask-outline',
    readTime: '6 min read',
    sections: [
      {
        heading: 'Is Nairobi tap water safe to drink straight?',
        body: "Nairobi Water & Sewerage Company (NWSC) treats mains water with chlorine to kill bacteria before it leaves the treatment plant. However, by the time it reaches your tap — through ageing pipes, storage tanks, and distribution infrastructure — contamination from bacteria (E. coli, coliforms) and turbidity is common, particularly after heavy rain or supply disruptions. Ultra Clear filters remove these risks at the point of use.",
      },
      {
        heading: 'What does Ultra Clear actually remove?',
        body: "The Ahlstrom Disruptor® filter (in all bottle products and the Sweet Home) is SGS-certified to remove:\n• >99.9% of bacteria (E. coli, Salmonella, Vibrio cholerae)\n• >99.9% of protozoa (Giardia, Cryptosporidium)\n• Chlorine taste and odour\n• Sediment and particulates\n\nIt does NOT remove dissolved salts, minerals (calcium, magnesium), fluoride, or viruses. For borehole water with high mineral content or fluoride, the Counter RO or RO Home System provides full TDS reduction.",
      },
      {
        heading: 'Is borehole water safe?',
        body: "Many Nairobi estates rely on borehole water, particularly during NWSC supply disruptions. Borehole water is typically lower in bacteria than surface water but may contain elevated fluoride (especially in Rift Valley geology areas), nitrates, and dissolved minerals. Filtering with an Ultra Clear bottle or faucet filter removes bacteria and turbidity. For full dissolved-solids reduction from borehole water, the Counter Reverse Osmosis or RO Home System is recommended.",
      },
      {
        heading: 'What about surface water (rivers, dams)?',
        body: 'Surface water such as Nairobi River, Mbagathi, and seasonal streams carries high bacterial loads, turbidity, and chemical runoff — especially near agricultural or urban areas. The Survivor Straw and EcoSmart Elite are certified for field use with surface water. For sustained household use, surface water should be pre-settled and then filtered through the EcoSmart Elite or a whole-home RO system.',
      },
      {
        heading: 'Does the filter remove fluoride?',
        body: 'The Ahlstrom Disruptor® cartridge does not remove dissolved fluoride. If you are in a high-fluoride area (parts of Rift Valley, central Kenya highlands), use the Counter Reverse Osmosis or RO Home System, which includes an RO membrane rated to reduce fluoride to safe levels.',
      },
      {
        heading: 'How much water can the filter process per day?',
        body: "There is no daily limit — the filter is rated by total volume (e.g. 150 litres per cartridge for bottles) rather than daily throughput. A household of 4 using a Sweet Home faucet filter for drinking and cooking uses approximately 8–12 litres per day, giving a cartridge life of 4–5 months at that rate.",
      },
      {
        heading: 'My filter is certified — what does SGS certification mean?',
        body: "SGS is the world's leading testing and certification company. SGS certification means an independent laboratory has physically tested Ultra Clear filters and confirmed they achieve the claimed performance (e.g. >99.9% bacteria removal) against the NSF/ANSI P231 standard for microbiological water purifiers. This is independent of Ultra Clear's own claims.",
      },
      {
        heading: 'Can I use my filter during a boil-water advisory?',
        body: "During an official boil-water advisory (typically issued when E. coli is detected in distribution mains), Ultra Clear filters certified to >99.9% bacteria removal provide effective protection. However, as an abundance of caution, we recommend boiling filtered water during active advisories — particularly for infants, elderly users, or immunocompromised individuals. The filter is not a substitute for official public-health guidance.",
      },
    ],
  },

  {
    id: 'filter-maintenance-checklist',
    title: 'Filter maintenance checklist',
    summary: 'A seasonal checklist to keep every Ultra Clear product performing at its best.',
    products: 'All Products',
    category: 'FAQ',
    icon: 'checkbox-outline',
    readTime: '5 min read',
    sections: [
      {
        heading: 'Monthly checks (all products)',
        steps: [
          'Inspect the filter housing for visible cracks or discolouration.',
          'Check all seals and O-rings — replace if flattened or cracked.',
          'Run a taste test: filtered water should be neutral. Unusual taste = time to replace the cartridge.',
          'Update your filter tracker in the Ultra Clear app with your current usage.',
        ],
      },
      {
        heading: 'Every 3 months — bottle filters',
        steps: [
          'Replace the bottle filter cartridge (UC-RPL-BTL-010) even if you have not reached 150 litres.',
          'Deep-clean the bottle body with a bottle brush and baking-soda solution.',
          'Check the lid thread and O-ring.',
          'Update filter tracker in the app.',
        ],
      },
      {
        heading: 'Every 4–5 months — faucet & shower filters',
        steps: [
          'Replace the Sweet Home cartridge (UC-RPL-FCT-014) or shower cartridge (UC-RPL-SHW-018).',
          'Clean the filter housing interior with a soft brush.',
          'Inspect PTFE tape on threaded connections — re-tape if frayed.',
          'Check flow rate: if noticeably slower than at first install, the new cartridge should restore it.',
        ],
      },
      {
        heading: 'Every 6 months — RO systems',
        steps: [
          'Contact Ultra Clear to schedule a professional cartridge service (included in the annual maintenance contract).',
          'Sanitise the storage tanks.',
          'Check the pre-sediment and post-carbon cartridges — these typically change at 6-month intervals.',
        ],
      },
      {
        heading: 'After a supply disruption or boil-water advisory',
        steps: [
          'Run filtered water for 3 full minutes before drinking.',
          'If the disruption lasted more than 24 hours, replace the cartridge regardless of age.',
          'Inspect faucet and shower filter connections for sediment accumulation.',
        ],
        warning: 'Do not reconnect to the mains after a burst-pipe event without first flushing the supply line for at least 5 minutes and checking that NWSC has lifted any advisory.',
      },
    ],
  },

];

/** All unique categories in display order. */
export const GUIDE_CATEGORIES: GuideCategory[] = [
  'Installation',
  'Filter Replacement',
  'Troubleshooting',
  'FAQ',
];

/** Icon to use for each category header. */
export const CATEGORY_ICONS: Record<GuideCategory, string> = {
  'Installation':       'build-outline',
  'Filter Replacement': 'refresh-circle-outline',
  'Troubleshooting':    'warning-outline',
  'FAQ':                'help-circle-outline',
};
