# Customer order receipt

Approved scope: a readable receipt in the existing order confirmation page and email, with screenshot-friendly presentation, PDF saving, and user-initiated sharing (including WhatsApp).

Use saved server order values, never the current cart or a fresh catalogue quote. Share formatting, receipt serial, payment labels, and payment-state rules between email and page. Include items, quantities, discounts, shipping cost when known, total, and delivery/collection details. COD is not proof of payment; missing evidence stays pending. Preserve existing payment and order creation behavior.

Signed-in customers use the existing owner-scoped order read. Guest confirmation retains only the successfully returned order in memory for this checkout session; no public receipt endpoint, personal data in URLs, or durable browser storage. After a guest reload, explain how to retrieve the emailed receipt.

PDF export on native uses Expo Print and the system sharing menu. Browser export prints an isolated receipt document with a Save as PDF option; never print app navigation. WhatsApp sharing is initiated by the customer and includes a receipt summary, not a public customer-data link. Unsupported/cancelled exports must not claim success.

Verify receipt arithmetic and escaping with unit tests, types with workspace checks, and page layout/export with one browser pass. Gmail iOS and Apple Mail evidence is still unavailable; browser previews must not be presented as actual-client certification.
