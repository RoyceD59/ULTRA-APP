# Product Management, Responsive Web, and WhatsApp Implementation Plan

## 1. API contract and product endpoints

- Document customer product list/detail, administrator product mutation, product media CRUD, upload request, and inventory operations in OpenAPI.
- Reuse the existing administrator gate, WooCommerce update path, App Storage upload verification, and product-media persistence.
- Regenerate shared API clients and schemas.
- Add focused authorization and validation coverage where the existing routes lack it.

## 2. ProjectHub product management

- Add an administrator-only Products route and navigation destination.
- Build a searchable product catalogue and full editor using the shared API Server.
- Support descriptions, pricing, stock, catalogue-image visibility, team media upload/removal, and customer-facing preview.
- Add price and stock quick edits to Inventory and link each row to the full editor.
- Refresh all affected queries after mutations and preserve form values on failures.

## 3. Companion responsive web

- Add reusable centered web content constraints.
- Make the product catalogue use a bounded responsive desktop grid.
- Make product detail use a bounded two-column desktop layout while preserving native/mobile behavior.
- Constrain product administration forms on web.
- Verify mobile, tablet, 1440px, and 1920px layouts.

## 4. WhatsApp reconnection

- Trace session lifecycle, disconnect cleanup, fresh initialization, QR emission, and ProjectHub polling.
- Ensure disconnect permits pairing a different number.
- Ensure ProjectHub displays fresh, expired, loading, and failed QR states.
- Add focused state-transition tests.

## 5. Integration and verification

- Review all changes for authentication, API-shape, and cache-invalidation consistency.
- Run code generation and type checks for shared libraries and all three artifacts.
- Run focused tests, then the full API suite if backend behavior changed materially.
- Restart API Server and ProjectHub once after the complete batch.
- Inspect logs and responsive screenshots before delivery.
- Do not deploy until physical-device review-media checks are completed.