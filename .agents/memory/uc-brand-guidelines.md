---
name: Ultra Clear Brand Guidelines
description: Complete brand system for UCFilters / Ultra Clear — colours, typography, logo rules, and digital application guidelines. Apply to ALL Ultra Clear designs (app, web, collateral).
---

# Ultra Clear Brand Guidelines (V1, Jan 2025)

## Colours

| Name | Hex | RGB |
|---|---|---|
| **UC Sky Blue** (primary background) | `#52b6dc` | R:82 G:182 B:220 |
| **UC Deep Ocean Blue** (primary brand / dark) | `#005d8f` | R:0 G:93 B:143 |
| **UC Onyx Black** | `#1a1a1a` | R:26 G:26 B:26 |
| **White** | `#ffffff` | R:255 G:255 B:255 |

**Why:** These four are the only permitted brand colours. No off-palette tints.

**How to apply:**
- Default UI background: white or Sky Blue (`#52b6dc`)
- Primary buttons / headings / interactive elements: Deep Ocean Blue (`#005d8f`)
- Tab bars, cards on dark backgrounds: Deep Ocean Blue with white text
- Error / warning states use the closest on-brand neutral (black), never red unless a system error colour is unavoidable

---

## Typography

### Primary typeface — **Gotham** (print)
Weights used: Black (heavy headlines), Medium (sub-headers), Book (body)

### Secondary / Digital typeface — **Century Gothic**
Weights: Regular (body), Bold (emphasis, CTAs)

**For mobile / web (Expo & React Native):**
- Gotham is not a Google/system font — use `'Barlow'` (Google Fonts) or `'Montserrat'` as the closest geometric sans-serif substitute available via Expo.
- Century Gothic substitute: `'Century Gothic'` ships on Windows/macOS; on Android/iOS fall back to `'Trebuchet MS'` or `'Nunito Sans'`.
- In practice for the UC Companion app: use `Barlow` for headings (Black/SemiBold) and `Nunito Sans` or system sans-serif for body.

**Why:** Gotham is a licensed desktop font; mobile apps need web-safe or downloadable alternatives that share the same geometric, all-caps-friendly character.

Register downloadable text fonts only for deliberate screen `fontFamily`
consumers; font registration alone does not change React Native's default
typography. A startup-payload optimization is not approval to replace existing
screen typography with brand substitutes.

**Why:** An unused Inter registration transferred roughly 1.37 MB while screens
kept rendering system fonts. Brand substitutes require an intentional visual
decision, not merely a font-loading change.

**How to apply:** Audit screen and navigation consumers before adding or
removing font loads; preserve system fallback and separately scope any visual
typography migration.

---

## Logo

### Two official lock-ups
1. **Primary (vertical):** "ULTRA" wordmark above the UC emblem, "CLEAR" wordmark below. Use on white backgrounds as often as possible.
2. **Secondary (horizontal):** "ULTRA" left of emblem, "CLEAR" right. Use when horizontal space demands it.

### Approved colour combinations
| Background | Logo colour |
|---|---|
| White | Deep Ocean Blue (`#005d8f`) — **preferred** |
| Sky Blue (`#52b6dc`) | White (reverse) |
| Deep Ocean Blue (`#005d8f`) | White (reverse) |
| Black / grayscale | White (reverse) |

### Clear space rule
Minimum padding = **2 × (1/3 of logo width)** on all sides.

### Logo don'ts
- Do NOT stretch or distort proportions
- Do NOT rotate
- Do NOT recolour with any colour outside the four brand colours
- Do NOT separate "ULTRA" or "CLEAR" from the emblem

---

## Digital Application Rules

- On digital ads, social posts, and in-app banners: **logo appears bottom-left**
- Imagery style: clean water photography — pouring water, filter cartridges, water bottles, lifestyle (active hydration). High-contrast blue tones.
- Three layout approaches for digital:
  1. Full bleed photo with minimal text overlay + logo bottom-left
  2. 2/3 photo / 1/3 white text panel + logo
  3. Full white/blue with bold typographic headline

---

## Logo asset locations
- Source lock-ups (attached by user): `attached_assets/ULTRA_CLEAR_Primary_Logo_Black_1_1784217273331.jpg`, `attached_assets/ULTRA_CLEAR_Primary_Logo_2_Reverse_Deep_Ocean_1784264709516.jpg` (CMYK JPEG — convert to sRGB before processing).
- **Cropped app lock-up (user-approved, July 2026): ULTRA wordmark + UC emblem with "CLEAR" cropped off.** Hi-res transparent PNGs in `attached_assets/brand/`: white (reverse, for blue/dark bg), deep-ocean `#005d8f` (for white bg), and the flattened original crop.
- The user explicitly approved separating the "CLEAR" wordmark for the app logo despite the brand book's "do not separate" rule — user instruction wins. App icon/splash use the white lock-up on `#005d8f`.
