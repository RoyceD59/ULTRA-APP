# Verified filter metadata and assignment walkthrough

Date: 2026-10-04

## Status

**Complete:** live catalogue evidence, ProjectHub assignment checks and the
remaining Companion browser hydration, reload and same-browser account-switching
checks passed. API-only reads were not counted as UI verification.

## Approved catalogue evidence

The team confirmed Hydra Flux at **150 litres or 2–3 months depending on water
quality**, then explicitly approved **90 days** as the reminder default.
This default is not a guarantee of three months of filter life.

WooCommerce product **8054**, “Ultra Clear Hydra Flux – 750 ml Stainless Filter
Bottle”, SKU **UC-BOG-SSB-008**, was identity-checked before updating only:

| Metadata | Verified value |
| --- | --- |
| `filter_capacity_litres` | `150` |
| `filter_lifespan_days` | `90` |

WooCommerce GET readback confirmed both values. The published API at
`https://team-horizon--jerryaroyce.replit.app/api/uc/products` and the development
API each returned 27 products and product 8054 with `filterCapacityLitres: 150`
and `lifespanDays: 90`.

Other products were left unchanged because their capacities were not approved.
No order, stock, price, payment, collection or real customer ownership was
changed in WooCommerce or the production database.

## Verified assignment behavior

Browser checks used the running development apps with the actual live
WooCommerce catalogue and disposable local database accounts/orders only.
The assignment page is `/admin/unsynced-registrations`, not `/impact`.

| Check | Evidence / result |
| --- | --- |
| Separate recovery and assignment sections | Both rendered on the assignment page. |
| Server preview | Hydra Flux, 90 days, 150 litres, awaiting collection. |
| Save pending | Assignment remained pending; linked account/filter were null; source order remained guest-owned. |
| Separate staff confirmation | Explicit confirmation linked ownership, created one filter and a staff-link audit. |
| Pre-signup reservation | Saving another pending assignment created no placeholder account or filter. |
| Unverified account | Matching new account remained unlinked before trusted-contact evidence. |
| Trusted-contact reconciliation | Both verification flags were set only on the disposable account; authenticated assignment read then linked it once without staff confirmation. No real email/phone verification messages were sent. |
| Customer detail | `/admin/customers` showed the matching Hydra Flux assignment, source order, installation date and awaiting-collection state. |
| Payment/collection invariants | Test orders stayed local COD, processing, awaiting collection, with no WooCommerce order ID. |
| Duplicate/incentive invariants | Exactly one filter per linked order; fixture canonical purchase/line and reward/referral counts stayed zero. |
| API account isolation | Local authenticated A/B/A reads returned A's assignment, none for B, then A's assignment again. **Not a UI account-switching result.** |

## Companion browser verification

The initial shared-proxy browser attempt failed to load the Expo entry bundle.
The correct Expo preview origin served the same bundle as HTTP 200 JavaScript,
and a direct `/auth/login` screenshot showed the rendered sign-in screen.
No Companion routing or application behavior was changed.

The initial continuation stalled and was stopped. On the approved retry, the
same tester continued only the unfinished Companion checks using fresh isolated
development fixtures and the runtime-sourced Expo preview origin. A browser
worker reset and mistyped origin were corrected before the successful check.
Completed ProjectHub steps were not replayed.

| Check | Evidence / result |
| --- | --- |
| A signs in through the local email/password UI | Account displayed the Hydra Flux assignment for local order 502, with two cleanings and the primary tracker. API readback confirmed 150 litres / 90 days. |
| Scoped activation storage | Product 8054, source order 502, 90-day rated lifespan, clean count 2 and empty `notifIds`; separate clean-count key also 2. |
| Existing maintenance preserved | Assigned filter and local primary tracker retained the two cleanings. The tracker displayed approximately 59 effective days / 90 rated days, with the existing post-cleaning lifespan adjustment. |
| Reload durability | After the assignments request completed, the same assignment and tracker remained visible. |
| A → B via UI sign-out/sign-in, same browser | B displayed “No staff-assigned filters on this account” and “Register your filter”, with no B activation or clean-count keys. A's stored state stayed scoped to A and was not exposed as B state. |
| B → A via UI sign-out/sign-in | A's assignment and tracker returned with unchanged scoped storage values. |
| No registration/reminder side effects | One expected assignment/filter, zero filter-reminder, order-outbox and reward-ledger rows for the fixture. |
| Payment/collection unchanged | Local order stayed processing / awaiting collection, with no WooCommerce order ID. |

The stable browser views and storage assertions passed. The tester also observed
a non-blocking React “Encountered two children with the same key” error toast
in both accounts. This did not invalidate hydration or account-isolation
assertions and is documented as a separate issue rather than fixed in this
verification task; it is not an error-free browser-console result.

## Preview blocker fixed

ProjectHub originally failed at startup because the linked shared
`blog-inline-links` CommonJS parser was served to the browser without conversion.
Its Vite configuration now explicitly prebundles the workspace entry and includes
the parser's CommonJS core in production conversion. Parser logic was unchanged.

Verification:

- ProjectHub TypeScript check passed.
- All six `ArticleBodyPreview` tests passed.
- ProjectHub production Vite build passed (existing size/sourcemap warnings).
- Restarted ProjectHub preview rendered its sign-in screen without the import
  error.

## Cleanup and safety

The completed assignment pass removed its five audit rows, two assignments,
two registered filters, two order items, two orders, three customer accounts
and one disposable team admin. An earlier navigation-only attempt removed its
two accounts, two orders, two items and one disposable team admin.
Both reported zero remaining tracked fixture rows.

After the stalled Companion continuation, a scoped read-only check found no
test team-admin rows or assignments created by those test admins. No test
credentials, bearer tokens or customer contact details are included in this
report.

The completed Companion retry removed its exact assignment/audit rows, filter,
order/item, A/B customer accounts, disposable admin and verification-token rows.
Final readback returned zero remaining rows for all tracked fixture IDs. A's
test-only storage keys were removed, B had none, and the browser was signed out.
No external payment, messaging, reward or WooCommerce action was performed.