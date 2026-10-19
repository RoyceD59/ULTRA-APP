# Ultra Clear Companion App: product page instructions for the Replit agent

Version 1.0, 7 October 2026. Owner: Jay (Ultra Clear Filtration Technologies Ltd).
Reference demo (Hydra Flux): https://claude.ai/artifact/KTaCuKXKPaVFkxbiUdGmJ5
Product data: `agent/products.json` and `agent/product_content.schema.json` in `_Companion_App_v2.1_2026-10`.

Build one shared product page component and apply it to every product. Hydra Flux is the reference. Do not hard-code Hydra Flux values; read everything from the product record.

## 0. Do not change

- The existing checkout and payment provider. They supersede anything shown in the demo.
- The existing delivery logic and charges, including self-paid delivery.
- The back-office photo upload (6 photos per product).

## 1. Page delivery (blocker, do first)

Today the page source contains only `<title>Ultra-Clear Companion</title>` and an empty `<div id="root">`. Search engines and WhatsApp previews get no product content.

1. Render product routes into the HTML on the server or at build time (for Expo Router: static or server output for web).
2. Give each product page its own `<title>`, meta description, canonical link, and Open Graph title, description and image.
3. Add Product and FAQPage structured data from the product record: name, image, SKU, price, currency KES, live availability.
4. Let the page scroll normally. The current shell sets `overflow:hidden` and a fixed height on the root.
5. Publish a sitemap listing every product address.
6. The canonical link must exclude query strings.

Hydra Flux values:
- Title: `Hydra Flux 750 ml Insulated Water Filter Bottle | Ultra Clear`
- H1: `Hydra Flux` with sub-line `750 ml Insulated Water Filter Bottle`
- Description: `Hydra Flux is a 750 ml stainless-steel insulated bottle with a replaceable filter. SGS-tested bacteria removal through 150 L. Delivered in Kenya.`
- Price: KES 4,199

## 2. Page layout

Follow the demo: one scrolling page in three parts (Choose, Understand, Decide). White ground, navy headings, teal buttons, pale aqua cards, line icons. It must work at desktop width as well as phone width.

Rules:
- Show a claim only when its status in the data is `verified`, `manufacturer` or `customer_reported`. Never render `confirm`.
- Say "tested by SGS (report number)", not "certified".
- No virus, cyst or heavy-metal removal claim on any product.
- Hydra Flux: keep the notice "Remove the filter before filling with hot or boiling liquids, juice, coffee or tea."
- Delivery: state no amounts on the page. Text: "Choose our delivery or self-paid delivery at checkout."

## 3. Photo gallery

Use the six back-office slots in this order, with these labels:

| Slot | Label | Content |
|---|---|---|
| 1 | Product | Product on a plain ground |
| 2 | In use | A person using it |
| 3 | Parts | Parts diagram |
| 4 | Included | What is in the box |
| 5 | Colours | All colours together |
| 6 | Size | In hand or beside a familiar object |

- Hide a slot that has no photo. Never show an empty box.
- Show the whole image (contain, not crop).
- Every photo needs alt text from the back office.
- If the selected colour has no photo of its own, show a note: "Photo shows {colour pictured}."

## 4. Buy now, stock and wishlist

- Buy now: add the product and selected variant to the cart, then open the existing checkout.
- Out of stock: disable Buy now and "Ask someone to pay"; show "Add to wishlist"; tell the customer they will be notified when it returns.
- No price on record (Derma Flux) or price by enquiry (Water ATM): no Buy now; show the enquiry route.

## 5. Ask someone to pay

The buyer builds the order; another person pays for that same order as a guest.

Flow:
1. Buyer selects the variant and taps "Ask someone to pay".
2. Buyer completes the order details in the existing checkout up to payment: delivery option, address, contact. The app saves the order as "awaiting payment" and creates a pay link.
3. Buyer shares the link by WhatsApp or copies the message.
4. Payer opens the link without signing in, sees the order summary, and pays with the existing payment provider.
5. On success the order is confirmed under the buyer's account. Buyer and payer each get a confirmation.

Pay link:
`https://app.ucfilters.com/pay/{order_token}?utm_source=share&utm_medium={whatsapp|copy}`

Message:
`Please pay for my Ultra Clear order: {name} {size}, {variant} ({sku}), KES {order_total} including delivery. Review and pay here: {pay_link}`

- URL-encode the whole message once for `https://wa.me/?text=`. The copy button uses plain text.
- `order_total` comes from the saved order, not from page text.

Safeguards:
- `order_token` is random and unguessable (at least 128 bits). Never use the order number.
- The link expires (suggest 72 hours) and stops working once the order is paid or cancelled. Show a clear message in each case.
- The payer sees: items, variant, quantity, total, delivery town or area, and the buyer's first name. The payer does not see the buyer's full address, phone number or email.
- The payer cannot edit the order. Collect from the payer only what the payment provider needs.
- Prevent double payment: lock the order while a payment is in progress.
- If price or stock changed since the order was saved, show the change and ask the buyer to refresh the order before payment is taken.
- The pay page is not indexed by search engines (`noindex`).

Fallback until the order link is built: link to the product page with the variant preselected:
`{product_page_url}?sku={variant_sku}&utm_source=share&utm_medium={whatsapp|copy}`

## 6. Compare bottles

On each bottle page, "Compare bottles" pulls the next product in and shows the two side by side.

- Default comparison: the next bottle in catalogue order. For Hydra Flux that is Truva Go.
- The customer can switch the second product to any other bottle in the category.
- Load the second product's data on demand; do not leave the page.
- Rows, all from the product records: photo, name, price, capacity, body material, insulated (yes/no), filter life, replacement cartridge price, tested evidence (report number or "none on record"), colours, stock.
- Omit a row when either product has no data for it. Do not fill gaps with estimates.
- Each column has its own "View" link and Buy now button.
- On a phone, show two columns that fit the screen with no sideways page scroll.
- Products held back by the price gate (Timbo, Breeze, Flex, Ultra Fold) are not offered for comparison.
- Use the same component for other categories later (showers, home systems).

## 7. Tracking

Send these events to Google Analytics: `view_item`, `add_to_cart`, `begin_checkout`, `purchase`, `add_to_wishlist`, `share` (method: whatsapp or copy), `pay_link_opened`, `pay_link_paid`, `compare_opened`.

## 8. Acceptance checks

1. View source of a product page contains the product name in a heading and the price.
2. Google Rich Results Test detects Product and FAQ with no errors.
3. A WhatsApp link to a product page shows the product name and photo.
4. Buy now opens the existing checkout with the chosen variant.
5. A pay link opened on a signed-out phone shows the buyer's order and takes payment as a guest; the order is confirmed in the buyer's account.
6. A paid, expired or cancelled pay link shows a message and takes no payment.
7. The pay page shows no full address, phone number or email of the buyer.
8. Compare shows Hydra Flux beside Truva Go, with no empty rows, and the second product can be changed.
9. Gallery shows only uploaded photos, in slot order, uncropped.
10. Out-of-stock product shows wishlist and disables Buy now and "Ask someone to pay".

## 9. Open items for Ultra Clear

- Real product page address format in the app.
- Pay link expiry period (72 hours suggested).
- Catalogue order of bottles, which decides the default comparison.
- Photos for slots 4 to 6 and for colours without photos.
