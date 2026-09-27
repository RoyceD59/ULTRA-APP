# Product Management, Responsive Companion Web, and WhatsApp Reconnection

## Status

Approved design for implementation.

## Goals

1. Let authorized ProjectHub administrators manage the products displayed in Companion.
2. Keep common inventory changes fast while providing a complete product editor for descriptions and media.
3. Make Companion web pages readable and appropriately sized on tablets and large desktop screens.
4. Define and document the shared API boundary used by ProjectHub and Companion.
5. Repair ProjectHub WhatsApp reconnection so a disconnected installation can display a fresh QR code and pair a new number.

## Non-goals

- ProjectHub and Companion will not communicate directly with each other.
- Product data will not be copied into a second ProjectHub-owned catalogue.
- WooCommerce catalogue images will not be deleted from ProjectHub.
- This work will not change the native Companion product experience unless a shared layout correction is required.
- This work does not remove the physical-device review-media verification required before deployment.

## Architecture

ProjectHub and Companion are separate clients of the shared API Server. Both clients authenticate with bearer tokens. The API Server enforces administrator access, reads and updates WooCommerce product data, manages team-uploaded product media, and returns the customer-facing catalogue consumed by Companion.

WooCommerce remains authoritative for product identity, catalogue descriptions, prices, stock, and base catalogue images. Team-uploaded photos and video remain in App Storage, with their product associations and ordering metadata stored in PostgreSQL. The API Server merges both sources when serving the Companion catalogue.

No browser or mobile client receives WooCommerce credentials or object-storage credentials.

## ProjectHub Product Management

### Navigation and permissions

- Add an admin-only **Products** destination to ProjectHub navigation.
- Reuse the existing ProjectHub administrator guard and bearer-token handling.
- Non-administrators cannot open product-management routes or call product mutation endpoints.

### Product catalogue

The Products page displays:

- Primary image
- Product name
- SKU
- Regular and sale prices
- Stock status and quantity
- Product source/availability state
- An action to open the full editor

The page supports search, stock filtering, loading, empty, partial, and explicit error states. A WooCommerce outage must not be presented as an empty catalogue.

### Inventory quick edits

The existing Inventory page retains its operational focus and gains quick controls for:

- Regular price
- Sale price
- Stock status
- Stock quantity

Each row also links to the full ProjectHub product editor. Successful changes refresh both Inventory and Products data. Failed changes retain the entered values and show an actionable error.

### Full product editor

The editor supports:

- Product name
- Full description
- Short description
- Regular price
- Sale price
- Stock status
- Stock quantity
- Base catalogue image visibility
- Team photo and video upload
- Removal of team-uploaded media
- Product preview using the same customer-facing fields returned to Companion

Descriptions are edited as plain text. Existing WooCommerce HTML may be rendered safely in preview, but the editor must not introduce an unsafe arbitrary-HTML editing surface.

Base WooCommerce images are labelled as catalogue-managed and read-only. Team uploads are labelled separately and may be removed. Uploads use the existing presigned upload flow and server-side metadata validation.

## Companion Web Responsiveness

### Global behavior

- Center page content within product-appropriate maximum widths on large screens.
- Preserve full-width backgrounds and navigation while constraining readable content.
- Avoid stretching forms, cards, paragraphs, and media across the full viewport.
- Keep keyboard focus, reduced-motion behavior, and touch targets accessible.

### Product catalogue

- Mobile retains the existing compact grid.
- Tablet increases usable card width without oversized gutters.
- Desktop uses a responsive multi-column grid inside a centered container.
- Very large displays add outer whitespace rather than continuing to enlarge cards.

### Product detail

- Mobile retains the stacked media, information, reviews, and actions layout.
- Desktop uses a two-column layout with the gallery on one side and product information/actions on the other.
- Reviews and supporting sections remain in a constrained content region below.
- Gallery sizing follows its container rather than the full browser width.

### Admin and supporting pages

Product edit/media forms and other visibly stretched pages receive reusable web-only content-width constraints. Native layouts should remain unchanged unless they share a safe cross-platform container rule.

Target verification widths are approximately 390px, 768px, 1440px, and 1920px.

## Shared API Contract

The OpenAPI source must document the routes used for this feature and regenerate shared schemas/clients after modification.

Required capabilities:

- List customer-facing products
- Read one customer-facing product
- Update administrator-editable product fields
- List a product's team-managed media
- Attach uploaded product media
- Remove team-managed media
- Request a presigned media upload
- List and update inventory
- Trigger inventory synchronization where already supported

The contract must specify:

- Bearer authentication requirements
- Administrator-only operations
- Path and request-body validation
- Product, image, media, stock, and error response shapes
- The distinction between omitted fields and explicit empty values, especially when removing a sale price

ProjectHub and Companion use the same deployed API origin configuration but keep their existing platform-specific API-base helpers. Neither client hardcodes a development hostname.

## Data Flow

### Product update

1. An administrator edits a product in ProjectHub.
2. ProjectHub sends a bearer-authenticated mutation to the API Server.
3. The API Server re-verifies administrator access and validates the request.
4. The API Server updates WooCommerce.
5. ProjectHub invalidates affected inventory, catalogue, and product-detail caches.
6. Companion receives the updated product on its next catalogue/detail refresh.

### Product media

1. ProjectHub requests a presigned upload URL.
2. The browser uploads directly to App Storage.
3. ProjectHub sends the resulting object path and media type to the API Server.
4. The API Server verifies stored-object metadata before attaching it to the product.
5. Customer-facing product responses merge base WooCommerce images with team media.

## WhatsApp Reconnection

WhatsApp repair is a contained workstream within the implementation and must not alter product APIs.

### Required behavior

- ProjectHub shows the live WhatsApp connection state.
- Disconnect invalidates the active session and removes server-owned pairing state that would prevent a new pairing.
- Starting reconnection creates a fresh pairing attempt.
- A newly emitted QR code appears in ProjectHub without requiring a page reload.
- ProjectHub refreshes status while the QR code is active and stops polling after success, terminal failure, or cancellation.
- QR expiry triggers a clear action to request a new code.
- Empty, expired, and failed QR states show actionable messages rather than a blank panel.
- Pairing a different number after disconnection is supported.
- Successful pairing is verified by the server connection state and a controlled send check where the existing tooling permits it.

WhatsApp credentials and session files remain server-side and must not be logged or returned to the browser.

## Error Handling

- Unauthorized and forbidden responses return the user to an appropriate ProjectHub state without exposing product or WhatsApp data.
- WooCommerce failures preserve unsaved form input and identify that the store update failed.
- Upload failures identify the rejected file or failed stage and do not attach incomplete media.
- Catalogue-source failures are distinct from a genuinely empty catalogue.
- WhatsApp pairing errors include a retry action and do not silently reuse a failed session.
- Client caches update only after server success.

## Verification

### Static and automated checks

- Type-check ProjectHub, Companion, API Server, and shared libraries.
- Regenerate OpenAPI clients and confirm generated code is clean.
- Run relevant API tests, including administrator authorization and validation.
- Add focused tests for product update input mapping, media lifecycle, cache invalidation behavior where practical, and WhatsApp reconnection state transitions.

### Visual checks

- Capture and inspect ProjectHub Products and editor pages at desktop and tablet widths.
- Capture and inspect Companion catalogue and product detail at mobile, tablet, 1440px, and 1920px widths.
- Confirm content is centered, cards do not over-expand, and no horizontal overflow appears.

### Runtime checks

- Update a test product through ProjectHub and confirm the API response and Companion refresh show the new description, price, and media.
- Confirm Inventory quick edits and full editor changes remain consistent.
- Disconnect WhatsApp, request a fresh QR, pair a different number, and confirm the connected state is reflected in ProjectHub.

Physical-device camera/library review-media upload, submission, reopening, and playback verification remains a deployment prerequisite and is not satisfied by browser testing.
