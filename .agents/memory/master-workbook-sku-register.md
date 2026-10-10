---
name: Master workbook SKU register
description: How the owner's UC_MASTER workbook feeds retail prices, the SKU register and app stock.
---
The owner's master workbook is the authority for retail prices and company SKUs; product page content stays the earlier uploaded v2.4 records (not WooCommerce).

**Why:** the user said the workbook is "company sku" and that pages must come from the uploaded records.

**How to apply:** regenerate JSON with the build-sku-master script (`--check` verifies). A new workbook means a new price revision (publish re-prices once at startup). Never put cost, margin or wholesale/corporate tiers in the repo or customer data. Stock quantities are applied only by the explicit apply script to rows still "unknown"; FUTURE means zero stock, out of stock until received. Workbook stock provenance (counted 12 Mar, partly estimated) is unconfirmed. Purchasability of Derma Flux is an owner decision.
