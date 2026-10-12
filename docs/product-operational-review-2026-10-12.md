# Product operational review — 2026-10-12

Read-only anonymous development evidence for the public-page prerequisites.
No commerce writes, uploads, price changes, activation or publication performed.
The current app-owned catalogue supersedes the historical WooCommerce audit.
Exact SKU equality is used; names are not identity evidence.

## Exact matches and prices

The existing audit script returned `catalogueVerified: true`. All 21 eligible
records have exact parent-SKU matches. All 20 numeric authored prices agree with
the observed catalogue prices. ATM has no numeric price; this is not evidence
that it is free. Stock observations are not promises or checkout authority.

| Record | Exact parent SKU | Development commerce ID | Authored / observed KES |
| --- | --- | --- | --- |
| HDF | UC-BOG-SSB-008 | 1000000 | 4199 / 4199 |
| TRG | UC-BOG-TRB-009 | 1000005 | 3199 / 3199 |
| VDR | UC-BOG-TRB-010 | 1000009 | 2299.99 / 2299.99 |
| GMB | UC-BOG-TRB-011 | 1000012 | 3599 / 3599 |
| SVS | UC-BOG-FST-016 | 1000015 | 1619.99 / 1619.99 |
| ECO | UC-BOG-ECO-ECF1 | 1000018 | 11990 / 11990 |
| FCT | UC-HOU-TAP-005 | 1000020 | 3299 / 3299 |
| DSP | UC-HOU-WDFS-006 | 1000022 | 3299 / 3299 |
| ROH | UC-HOU-ROS-001 | 1000024 | 27990 / 27990 |
| PHR | UC-HOU-PHRO-001 | 1000026 | 37990 / 37990 |
| UPR | UC-HOU-URO-001 | 1000028 | 16990 / 16990 |
| UP2 | UC-HOU-URO-002 | 1000030 | 17990 / 17990 |
| AQD | UC-HOU-USF-004 | 1000032 | 13990 / 13990 |
| PSH | UC-HOU-WPF-003 | 1000034 | 14990 / 14990 |
| SHJ | UC-SKW-SHF-021 | 1000036 | 4099 / 4099 |
| SHC | UC-SKW-SHF-019 | 1000038 | 3299 / 3299 |
| SHD | UC-SKW-SHF-020 | 1000040 | 2569.99 / 2569.99 |
| SHP | UC-SKW-SHF-022 | 1000042 | 2429.99 / 2429.99 |
| DFX | UC-SKW-DFS-024 | 1000044 | 7099 / 7099 |
| ROC | UC-COM-ROS-002 | 1000046 | 56999 / 56999 |
| ATM | UC-ATM-001 | 1000048 | null / empty |

## Unresolved six-slot photo evidence

Every matched record returns zero accepted commerce gallery slots and
`product-photo-missing`. SVS is now missing evidence for all six slots, not just
2–6. Authored filenames are not uploaded image evidence: all authored gallery
entries in the v2.6 source remain unapproved. Fit/installation illustrations
are separate and do not establish six-slot gallery completeness.

There are no accepted gallery URLs to decode or test as a crawler. Do not
substitute old WooCommerce URLs or infer which photos belong to a product.
Owner-approved images must be assigned through the existing upload interface,
preserving their intended slots and alt text, then anonymously fetched and
visually reviewed. The eleven unpublished drafts are outside this 21-record
audit and must remain unpublished and non-purchasable.

## Published crawler observations

Anonymous requests using `facebookexternalhit/1.1`:

- `https://app.ucfilters.com/robots.txt`: HTTP 404.
- `https://app.ucfilters.com/product/hydra-flux`: HTTP 200, but raw HTML has
  the generic `Ultra-Clear Companion` title and no `Hydra Flux` text.
  This is an app shell, not proof of product-specific crawler rendering.

These observations neither activate pages nor verify a new release. Current
host, checkout identity and transaction-time price/stock checks remain unchanged.

## Required owner review

On 2026-10-12, the owner approved the 21 exact SKU matches and 20 numeric
prices in this report and chose to supply approved photos and slot assignments.
The owner will upload those photos through ProjectHub; no files were supplied
in chat. Use those uploads for the subsequent audit rather than substituting
authored filenames or historical WooCommerce images.
This does not approve a price for ATM, photo substitutions, activation or
publication. Photo remediation and subsequent anonymous image/crawler
verification remain blocked on the supplied assets.

Review the exact mappings and numeric prices above; explicitly choose a photo
remediation scope using supplied, approved images. ATM's absent price requires
an explicit decision before any priced sale. After scoped remediation, rerun
the anonymous audit, check actual image decoding and crawler access, and obtain
separate activation/publication approval. This report does not supply that approval.

## ProjectHub upload check (2026-10-12, read-only)

The published database holds 8 team photo rows (latest 13:06 UTC), all attached
to the legacy WooCommerce-era product 10170 "Faucet Filter Cartridge" (no SKU)
with position 0, so no slot 1–6 is assigned. Seven are anonymously retrievable
(HTTP 200) through the published API; one is the earlier fit chart. None is
linked to any of the 21 approved SKUs, and the app-owned catalogue uses new
product IDs. Visible content is tap-filter marketing and cartridge diagrams, so
it does not establish which record or slot each photo belongs to. No mapping was
inferred; the development database has no uploads. Still required: the intended
product and slot for each photo, then uploads for the remaining products.
