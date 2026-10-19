# Companion commerce cutover — operational approval still required

The development source no longer uses WooCommerce as a runtime catalogue,
identity, order-write or history-sync authority. It does not activate a new
published release. Keep the separate website and its credentials unchanged.

## Before any publication

1. Select and verify the intended API and native/browser release packages.
   Existing retained packages may serve older code. Verify the actual endpoint
   identities, not just a successful deployment status.
2. Review canonical parent/child SKUs in ProjectHub. App product IDs occupy a
   new namespace; old cart IDs and links are not silently remapped by name.
3. Establish verified parent and variant stock in ProjectHub Inventory.
   Unknown stock blocks admission. A blank count explicitly means unmanaged,
   not zero. Counts are on-hand; available quantities exclude active holds.
   Review the purchase switch and lifecycle specifications separately.
4. Attach/copy approved product photos through the existing app-owned upload
   flow and approve their exact product/variant associations in the record
   editor. Do not depend on external Woo gallery URLs or map media by name.
5. Prepare a protected offline order export and reviewed account ownership map.
   Do not commit these files or log contact data.
6. Preview the import against an initialized target schema. Preview performs
   no DDL or data writes. Investigate conflicts, unmatched accounts and
   pre-existing anchors; no export can overwrite an unresolved checkout.
7. Obtain explicit approval before applying any production import, writing
   verified inventory baselines to production, or publishing.
8. Test customer ownership, existing-account recovery, prepared checkout,
   pending-provider recovery, promotion retries, COD collection and history
   after activation. Then resume real iPhone/Android receipt PDF save/share,
   cancellation and temporary-file cleanup checks.

## Offline history bundle

The JSON format is:

```json
{
  "version": 1,
  "sourceReviewed": true,
  "reviewedBy": "operator-reference",
  "owners": [
    {
      "wooCustomerId": 123,
      "userId": 456,
      "reviewed": true,
      "reviewedBy": "ownership-review-reference"
    }
  ],
  "orders": []
}
```

`orders` contains authentic reviewed Woo export snapshots, including stable
order/customer IDs, totals, currency, payment method, line item snapshots and
UTC creation/payment timestamps. Names and email equality are not proof of
ownership. A completion status alone is not proof of payment or COD collection.
The tool retains exported paid timestamps as historical source data only.
Neither those timestamps nor status automatically set the app's paid/collected
state. To import verified payment proof, supply a separate `verifiedPayments`
array containing `wooOrderId`, `reviewed: true`, `reviewedBy`, `reference`,
`confirmedAt`, `amount`, `currency` and `kind` (`provider_payment` or
`cod_collection`). The amount, currency and evidence kind must match the order.
Review each proof independently; omit disputed evidence so it stays unverified.

From the API package:

```sh
pnpm exec tsx scripts/import-companion-history.ts --input=/protected/reviewed-export.json --preview
```

After separate authorization, `--apply` writes atomically. Production or an
unknown environment also requires `--approved-production-import`; that switch
records the operator's decision and is not authorization from this agent.
Output contains counts only. Repeating an identical import does not duplicate
an imported order. Changed snapshots and existing anchors remain under review.

## Master workbook stock snapshot

The v7 workbook quantities are not applied by startup or publication. Run
`pnpm exec tsx scripts/apply-sku-master-stock.ts` to preview and add `--apply`
to write (development by default; production also needs
`--approved-production-import` and owner sign-off). Only rows still "unknown"
change, so repeats and later staff counts are safe. Retail prices, by contrast,
are re-imported once automatically when a publish starts the API with the new
price revision.

## Limits of preparation

- The public history notice remains pending until completeness has been
  independently reviewed; importing one file does not certify a whole fleet.
- Unknown or paid cancellations retain reserved inventory. Independently
  reconcile their payment/fulfillment before a staff inventory correction;
  neither an elapsed timer nor a refund status proves goods returned.
- Legacy Woo-transport test fixtures are not evidence for the new source.
  The focused source checks are not a full-suite or signed-in browser pass.
- No operational data has been imported into production as part of this work.
