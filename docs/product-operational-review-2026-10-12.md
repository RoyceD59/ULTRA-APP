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

### Update after owner finished uploading

A later read-only check found 12 team photo rows: 8 on legacy 10170 and 4 on
legacy 8042 (the old Sweet Home / FCT record), all at position 0 and all
anonymously retrievable. The other 20 records still have no uploads. Because the
new catalogue uses new product IDs (FCT is 1000020 in development), these rows
will not appear on the new pages until they are re-uploaded to the new records or
a scoped mapping is explicitly approved. Six-slot evidence is therefore still
unmet for all 21 records.

Page structure (same day): product pages now show only structured fields, and
the category tabs match the four record categories. See the change log.

### Photo mapping applied (owner instruction, not published)

The owner told the agent to use the ProjectHub pictures. Mapped by exact record
code, with alt text describing only what is visible: FCT slots 1, 2, 3, 5; VDR
slots 1-5; GMB slots 1-6. Not mapped: Flex (draft), Viva Drop video, and the
cartridge listing (no SKU). 18 records still have no approved photo. After
publishing, anonymously fetch each mapped URL and review it visually.

## Owner activation approval and final prerequisite checks — 2026-10-13

The owner explicitly selected **“All three, including Gym Buddy”** after being
shown the four/five/six-photo coverage and the different legacy Gym Buddy SKU.
This approves only the ProjectHub-upload mappings and photo-backed pages for
FCT (Sweet Home), VDR (Viva Drop), and GMB (Gym Buddy). It confirms that the
legacy Gym Buddy uploads belong to the current Gym Buddy record; it does not
establish SKU equality between the legacy listing and the new record.

Approval is not activation evidence. No release selector, production database,
checkout, host, prices, stock or payment logic was changed by these final checks.
Publication remains a user action after the release-readiness gates pass.
Other products, historical website photos, Flex, the Viva Drop video and the
unidentified cartridge-listing photos remain outside this approval.

### Anonymous photo and development-record evidence

- All 15 approved upload URLs were fetched anonymously through the live API
  using `facebookexternalhit/1.1` and `?w=640`. Every response was HTTP 200 with
  image content and successfully decoded through the existing Sharp dependency.
  A contact sheet was visually inspected; these are real uploaded product/use
  photos and diagrams, not generated filename placeholders. The requests required
  no session, cookies or authorization header. Photo approval does not validate
  filtration claims printed within the supplied diagrams.
- The anonymous development product-record API returned 21 exact parent-SKU
  identities; all 20 numeric authored prices matched its observed live prices.
  ATM still has no approved numeric price.
- A 402×874 development browser screenshot of `/product/sweet-home` showed
  the real uploaded main photo, all four thumbnails and product details without
  a runtime error. This verifies the preview, not the published page or native
  device behavior.
- Direct record responses preserve the intended slots:

| Approved record | Approved gallery slots | Coverage still absent |
| --- | --- | --- |
| FCT / Sweet Home | 1, 2, 3, 5 | 4 and 6 |
| VDR / Viva Drop | 1, 2, 3, 4, 5 | 6 |
| GMB / Gym Buddy | 1, 2, 3, 4, 5, 6 | None |

- The other **18**, not 17, eligible records have no approved photos. The eleven
  unpublished drafts remain outside the reviewed set.
- The existing anonymous audit was rerun against both development HTTPS and
  the live API. Its legacy catalogue-photo adapter renumbers FCT slot 5 as 4;
  therefore its inferred slot list is not exact-slot evidence. The direct
  `/api/uc/product-records/:slug` responses above are authoritative for the
  new pages. Neither local filenames nor inferred image order was accepted.

### Live publication blockers and handoff

- The latest observed served Companion build is `1791820215559-828`, with the
  unchanged frozen consistency source revision. A successful publish did not
  include the newer product-record API/mapping source.
- `https://api.ucfilters.com/api/uc/product-records` and its Sweet Home detail
  route return HTTP 404. The anonymous audit rejects the live legacy catalogue
  as incompatible publication-safe evidence; this does not mean that the
  separate legacy `/api/uc/products` endpoint has no products.
- Legacy catalogue images precede the ProjectHub uploads. Sweet Home has 15
  images, Viva Drop 17 and Gym Buddy 11; their approved uploads number 4, 5 and
  6 respectively. A first-six gallery can hide the appended uploads. Samples
  of both legacy leading images and upload derivatives returned HTTP 200.
- Crawler requests to `/product/sweet-home`, `/product/viva-drop` and
  `/product/gym-buddy` return HTTP 200 but only a generic 1,733-byte app shell
  titled `Ultra-Clear Companion`, not verified product-specific HTML.
  `/robots.txt` still returns HTTP 404.
- Before activation, the publication-readiness work must include the approved
  mappings and compatible API/public rendering in a scoped release package,
  restrict activation to these three photo-backed pages, and verify actual
  served images/slots/crawler HTML after publication. Do not bypass the frozen
  release by publishing the whole working tree or substitute old website photos.
- Source preparation, owner approval and image availability are verified.
  Live page activation, compatible live identity/pricing and crawler rendering
  remain unverified and blocked on the scoped release. Retain transaction-time
  commerce authority and existing checkout identities through that release.
