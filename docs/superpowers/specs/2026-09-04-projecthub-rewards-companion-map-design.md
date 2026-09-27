# ProjectHub Rewards and Companion Experience

## Scope

ProjectHub remains a React/Vite browser web application with responsive desktop and mobile-browser layouts.

## Rewards redemption

- Reward redemptions remain append-only negative ledger entries.
- A successful redemption deducts immediately from the user's spendable balance.
- Lifetime redeemed points are derived from redemption ledger entries, not a mutable counter.
- ProjectHub shows an organization-wide lifetime redeemed total and each user's current balance and lifetime redeemed total.
- Redemption remains transactional and idempotent.

## Companion rewards QR

- The account screen must render the latest server-authoritative opaque rewards QR token.
- Secure storage is only an offline fallback.
- Loading, recovery, and failure states must not leave the screen indefinitely blank.
- This scope does not duplicate the separate real-device staff scanner task.

## Impact sharing

- Shared impact statistics render as a branded badge card rather than plain text alone.
- The badge includes the user's impact amount and Ultra-Clear context without exposing private account data.
- Native sharing uses the badge image when supported and a concise text fallback otherwise.

## Companion map

- The map consumes verified public locations only.
- Available markers are framed automatically, with clear loading, empty, and error states.
- Directions open Apple Maps on iOS and Google Maps on Android and web, with a browser fallback.
- Admin location management remains outside this implementation to avoid overlapping the active location-management task.

## Verification

- API tests cover balance deduction and lifetime redeemed totals.
- ProjectHub tests cover aggregate and per-user redeemed values.
- Companion tests cover QR recovery, impact badge data, and platform-specific map links.
- Run library and artifact typechecks, API tests, Expo Doctor, and preview/log checks.