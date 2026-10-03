# Companion global impact and forest entry points

The owner approved an in-app About Us page with shared global impact and a forest
link, rather than making About Us redirect directly to the forest.

- Home has a small external forest link under global UC Impact and an About Us
  entry point. About Us is a public route with factual Ultra Clear Companion and
  programme copy, the same global figures, and forest/official-site links.
- Global figures come from the existing `/api/uc/impact` endpoint managed through
  ProjectHub. One account-independent query/cache is shared across Home and
  About, refreshed on navigation, app foreground, reconnect and every minute.
  Loading/error states must not substitute zero figures. No customer rows are
  bulk-updated and no personal ledger is copied into the global figures.
- Personal impact opens expanded for signed-in customers, retaining litres,
  carbon estimates, milestones and refill behavior. No-tree/error customers can
  browse the public forest without an invented personal tree. Real personal tree
  links contain only an anonymous ID and a validated stage.
- The existing 3% equal allocation, no refill funding and pending field-evidence
  rules remain unchanged.

Verify types, query/privacy tests, the public About page and API no-cache behavior.
Refresh the frozen publishing archive narrowly; preserve all unmodified archived
source rather than building unrelated working-tree features. Owner Publishing,
successful production customer sign-in and native/device checks remain separate
from preview and package verification.