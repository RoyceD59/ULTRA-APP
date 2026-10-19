# Complete WooCommerce disconnection

## Owner direction and approval boundary

The owner requests that Companion supersede WooCommerce development and that
ProjectHub adopt Companion's new product schema. On 2026-10-10 the owner chose
complete disconnection, including replacement of Woo-backed authentication and
historical order syncing, rather than a products-only change.

That is approval of scope. This document is the proposed design for review,
not evidence that migration, source implementation or publication is complete.
The work belongs in the existing Companion, ProjectHub and API artifacts.
The separate WooCommerce website is not to be shut down or altered.

## Current evidence

- The existing authored Companion product contract and persistent editorial
  records already describe products, child SKUs, specifications, sections,
  gallery mappings, SEO and approved prices.
- ProjectHub still has Woo-dependent operational product editing and inventory.
  Authored product records resolve their operational identities through Woo.
- Checkout verification still reads Woo publication, identity, stock and
  purchase eligibility. Removing only an eligibility check would not deliver
  independent product ownership.
- A read-only development quotation for one EcoSmart Filter returned HTTP 422.
  A fresh product-provider read reported a published, simple, in-stock product
  with price 9799 and `purchasable: false`. No order or payment was created.
- The published API did not expose the current source's checkout-quote route.
  This is an additional release-consistency concern, not proof that the phone
  screenshot used that endpoint or build.
- The supplied phone screenshot shows a blocked checkout, not a native saved
  PDF or successful sharing handoff. Real receipt-device verification remains
  incomplete and must not be inferred from this migration.

## 1. Shared app-owned product contract

Extend the existing Companion authored contract rather than replacing its page
content or introducing a second incompatible catalogue. Use shared validation
and API types for Companion and ProjectHub, with persistent operational records
for product identity and inventory.

The shared model covers:

- Stable app product ID, product code, slug, unique parent SKU and child SKUs.
- Name, category, variants, specifications, page sections, FAQ and SEO fields.
- Publication/archive state, explicit purchase availability and enquiry-only
  behavior, with the existing held-back/content approval boundaries preserved.
- Persistent retail price and currency, authorized edits and revision metadata.
- Approved media mappings and durable app-owned media references.
- Inventory policy: stock status, managed/unmanaged quantity, backorder policy
  and variant-specific stock where applicable.
- Legacy Woo IDs as migration provenance/crosswalk only, not runtime authority.

The approved Excel CATALOGUE RETAIL prices initialize the persistent prices
once. Later authorized editor changes survive restarts. Do not adopt Woo prices
or disable price verification merely to unblock checkout.

No identity mapping by display name. Use exact, unique, evidenced identities or
an explicitly reviewed crosswalk. Missing/ambiguous mappings are reviewable
failures, not invented SKUs, replacement products or zero stock. Legacy carts
that cannot map safely require a clear refresh; never silently substitute an
item. Historical line snapshots remain readable even if a product is archived.

Stock must have a verified import baseline or explicit authorized staff input.
Unknown stock is not manufactured as available. Unmanaged quantity is not zero.
Authored purchase availability becomes app-owned after the approved cutover;
the old Woo purchase flag must not continue vetoing new Companion orders.

## 2. ProjectHub and Companion behavior

ProjectHub products and inventory read/write this same model. Replace Woo edit
actions and comparison-as-authority messages with app-owned operations.

Provide the necessary create, edit, variant, publication/archive, stock and
media management behavior; archiving must preserve orders and filter history.
Enforce permissions on server endpoints, not just page visibility. Stock and
price edits require validation, conflict handling and an audit trail without
credential or customer-data logging.

Companion browsing, product details, recommendations, basket validation,
checkout, registration/lifecycle linking and administrative product editing
must all resolve the shared records. No demo catalogue fallback may authorize
an order. Missing data/services produce clear failures and recovery guidance.

Keep approved product content, prices, promotion rules, delivery/collection
choice and existing customer-owned history intact. Do not enable held-back
products or unfinished saved-payment/refill features as a side effect.

## 3. Orders, payments and inventory

Make local order persistence the source of truth for every new Companion order,
independent of whether Woo credentials are present.

Use server-verified product/variant identity, price and stock from the shared
model. Reserve managed stock atomically against the durable checkout identity.
Retries must reuse the same admitted checkout, not reserve stock or create a
second order. COD reserves stock but remains unpaid until recorded collection
or other verified payment evidence exists.

Preserve the current promotion reservation and payment recovery contracts.
Paystack/M-Pesa and any already-enabled provider remain direct integrations;
this migration must not activate an inactive provider. Pending/unknown payment
outcomes remain attached to the original reference and immutable checkout.
Never release reservations just because a timer elapsed or an app restarted.

Cancellation, failed payment, fulfilled order and return/stock correction need
explicit, deduplicated inventory transitions. Ambiguous old attempts remain
recoverable or staff-reviewable rather than being replaced with a fresh charge.
Do not report success based on a provider outage or development simulation.

Email, confirmation-page, screenshot, PDF and WhatsApp receipt formats continue
using the same order snapshot and verified paid/pending disclosure.

## 4. Customer authentication migration

Keep existing local customer IDs and their linked rewards, filters, purchases,
impact, preferences and histories. Preserve native Companion passwords and
existing verified social sign-in; no unrelated authentication-provider change.

Woo-only customers cannot have their password inferred, recovered from Woo or
replaced with a shared default. Their local account transition uses a verified,
customer-initiated recovery/password-setup flow against the preserved identity.
Ensure this recovery works without calling Woo, including the eventual absence
of Woo credentials. Keep token hashing, expiry, enumeration protection,
credential-mutation concurrency and session rejection rules.

Do not claim an existing password/social account by email similarity alone.
Retain ownership/provider-link evidence and explicit review for conflicts.
Preserve approved session lifetime; publication must explain any unavoidable
one-time sign-in rather than silently invalidating access.

No bulk email sends, credential resets or account relinking are authorized by
this design. Recovery delivery and real account migration are separate,
explicitly approved operational steps.

## 5. Historical orders and migration records

Before retiring live history reads, provide an idempotent import/reconciliation
tool with a read-only preview and a report of mapped, conflicted and unresolved
records. Import historical Woo order/line snapshots, provider references,
verified payment evidence, fulfillment details and provenance without creating
new sales, recharging, resending receipts or awarding rewards a second time.

Customer-owned imports require exact, evidenced ownership. Guest/ambiguous
orders are not automatically assigned by name or email. Preserve local order
keys and existing pending checkout links; show unresolved history explicitly
rather than treating missing evidence as an empty history or an unpaid order.

Migration writes must be resumable/idempotent and distinguish an already
imported record from an incomplete attempt. Do not overwrite a verified newer
local state with an older imported status. Import logs/reports use safe counts
and categories; customer/contact details stay in appropriately protected data.

Development fixtures may exercise the import without affecting production.
Production imports and any required reconciliation must be reviewed and
approved separately with counts, ownership conflicts and rollback implications.

## 6. Retirement and release boundaries

Inventory all Woo-dependent runtime paths, not just checkout: account/profile
lookups, history, product/category/recommendation/media reads, product/stock
writes, order creation/reconciliation, alerts, scheduled jobs, webhook handlers,
customer assignments, recovery tools and commerce-related public evidence.

After their replacements and migration checks pass, disable/remove runtime Woo
calls and writeback jobs for Companion/ProjectHub. Legacy IDs remain provenance,
not a reason to contact Woo. Migration-only tooling stays outside runtime
bundles and requires an explicit operator command.

Receipt/payment webhooks from the active payment providers must continue
working with signature validation, deduplication and preserved original
references. Retired Woo event handlers must not mutate the new catalogue or
replay imported history. If old in-flight workflows cannot be resolved safely,
block cutover and surface them for review rather than abandoning them.

Where product media currently depends on the old store, prepare verified
durable app-owned copies and mappings without replacing approved images with
placeholders. This must not alter the separate Woo website or its media.

Configured Woo secrets must not reactivate an old runtime branch. Do not delete
or revoke shared credentials as part of source implementation. Review other
consumers before any later credential retirement.

Schema changes are additive and migration-aware. No destructive drop,
truncation or database replacement. Preserve existing frozen-release controls.
Changing source does not advance a retained release or publish it. API,
ProjectHub and native/browser clients must be activated as a compatible set
only with separate publication approval and served-build verification.

Rolling back code after local orders/stock changes exist must not reconnect a
stale Woo authority. Specify the data/reconciliation consequences before an
operator is offered rollback.

## 7. Development sequence and verification

All units below are required for the complete requested disconnect:

1. Shared product/variant/inventory persistence, contract and safe identity
   mapping; ProjectHub management and Companion reads use that model.
2. App-owned quotation, atomic stock/order/payment/recovery behavior, receipt
   consistency and removal of new-order Woo writes.
3. Verified local recovery for Woo-only customers, historical import preview,
   idempotent import/reconciliation and continuity of customer-linked records.
4. Retire runtime Woo jobs/reads/webhooks, verify media independence, then
   prepare the compatibility/cutover evidence.

Verify with injected synthetic providers/data, isolated test storage/databases,
focused tests and typechecks. Exercise create/edit/archive and variant states,
unknown/unmanaged/out-of-stock inventory, concurrent orders, idempotent retries,
paid/COD/pending receipts, cancellation and delayed payment confirmation.

Authentication/history checks must cover identity conflicts, reset setup,
ownership restrictions, duplicate imports and pending legacy references.
Assert that representative Companion/Hub flows make no Woo calls even when
Woo credentials are configured. No real customer sign-in, email, payment,
order, stock adjustment or production import as part of automated fixtures.

One scoped browser pass is appropriate after the coherent critical flows are
implemented; it is not physical iPhone/Android printing or sharing evidence.
Real device receipt checks still require the saving/sharing/cancellation/source
cleanup evidence requested separately.

## Definition of done and explicit non-authorization

Done means both apps use the shared model, new commerce and migrated identity/
history no longer need Woo at runtime, data continuity is demonstrated, and
errors do not silently fall back to demo data or an old store authority.

Source completion, import readiness, cutover and publication are distinct.
This review does not authorize production data migration, publication, real
orders/payments, customer communications, secret deletion, activation of
unfinished features or retirement of the separate WooCommerce website.
