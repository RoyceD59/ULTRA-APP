# Alison Products welcome bubble — regression checks

## Verification status

The user approved replacing the between-rows banner with a floating welcome
bubble on 2026-10-04. Between-row placement is therefore no longer an acceptance
criterion. The bubble keeps the eight-second delay, filter suppression,
mounted-session dismissal, and tap-to-chat behavior.

Nine focused hook/component tests and Companion TypeScript checking passed.
The read-only interactive Chromium check passed against the running Expo web
preview at 390 × 844. It confirmed absence at 7,999 ms, visibility at 8,000 ms,
floating placement within the viewport above navigation, search/category
suppression and restoration, actual `/ai-chat` navigation, dismissal through
waiting/filter changes/tab navigation, and reset on reload, without browser
runtime errors. The browser check uses a controlled clock; it is not a measured
physical-phone launch time. Component tests use stub rendering.

Physical-device verification is still outstanding. Neither source inspection,
stub-rendering tests nor mobile-sized Chromium qualifies as phone evidence.
No phone recording or device details were provided.

## Repeat automated checks

From `artifacts/uc-companion`:

```sh
TSX_TSCONFIG_PATH=$(pwd)/tsconfig.test.json node --import ./test-setup.mjs --import tsx/esm --test hooks/__tests__/useAlisonNudge.test.mts components/__tests__/AlisonWelcomeBubble.test.mts
pnpm exec tsc --noEmit
node scripts/check-alison-nudge.cjs
```

The browser check requires the running Expo web preview and API, with a nonempty
catalogue. It uses `REPLIT_EXPO_DEV_DOMAIN` or an explicit `ALISON_TEST_BASE_URL`,
and `CHROMIUM_PATH` or the provisioned `/repl/tools/bin/chromium` if available.
It reads catalogue data and navigates locally; it creates no accounts, orders,
messages or other server-side records.

## Setup

- Use a physical Android or iOS phone running the current Companion source
  in Expo Go or a development build. Record phone model, OS, app/build identity,
  and test date. Do not assume a published build contains the current source.
- Start with an empty basket, no search text, and category **All**.
- Load at least one product. Record the number of columns.
- Identify the **floating** bubble reading “Hi, I’m Alison!” /
  “Need help choosing a filter? Let’s chat.” The welcome card above the
  catalogue is a separate surface and does not count as this nudge.
- Screen-record each run with elapsed time visible if possible.

## Checks

| Check | Procedure | Expected | Device result |
| --- | --- | --- | --- |
| Eight-second delay | Freshly mount Products (reload if already mounted). Start timing when the screen mounts, not when products finish loading. Inspect before eight seconds and after eight seconds. | Bubble absent before eight seconds; eligible after eight seconds once products are available. | Not run |
| Floating placement | Once visible, scroll through the catalogue. Repeat with items in the basket and with larger system text. | Bubble stays above bottom navigation and checkout, without moving, skipping or duplicating product rows. Text and both buttons remain usable. | Not run |
| Search suppression | With nudge visible, enter a matching search term, then clear it without leaving the screen. | Nudge disappears while search is nonempty and returns when cleared. | Not run |
| Category suppression | With nudge visible, select a non-All category, then select All. | Nudge disappears in the selected category and returns in All. | Not run |
| Filtering during delay | Fresh mount; enter search text or select a category before eight seconds. Keep it active beyond eight seconds, then clear it. | No nudge while filtered; clearing reveals it without a second eight-second wait. | Not run |
| Open chat | Tap the welcome text/avatar in the floating bubble, not the separate welcome card. | Alison chat opens. No chat message needs to be sent. | Not run |
| Session dismissal | Return to Products and close the floating bubble. Wait at least ten seconds; search/clear; category/All; scroll; leave the tab and return without reloading. | Nudge remains hidden throughout the same mounted Products session. | Not run |
| New-session reset | After dismissal, genuinely unmount/remount Products or reload the app, then wait eight seconds with All/no search. | Nudge may appear again; dismissal is not persisted across mounts. Switching tabs alone may preserve the original mount. | Not run |

## Source observations (not device confirmation)

`hooks/useAlisonNudge.ts` uses a mount-only 8,000 ms timer and clears it on
unmount. A ref records dismissal, and dismissal also clears visible readiness.
Nonempty search or a non-All category suppresses display without resetting the
timer. Visibility also requires at least one product.

The product list always receives every product, independent of the bubble.
`components/AlisonWelcomeBubble.tsx` is rendered outside the scroll view with
absolute placement and cart clearance. The welcome tap pushes `/ai-chat`.

Existing automation identifiers:

- `products-alison-nudge`
- `products-alison-nudge-open`
- `products-alison-nudge-dismiss`

Attach device recordings and fill actual outcomes before calling this
physical-device verification complete.