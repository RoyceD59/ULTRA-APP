---
name: Customer contact completion
description: Required transaction contact details without blocking legacy login or using addresses as ownership evidence.
---
Require a valid normalized phone and nonblank contact address for new customer registration, account completion, every checkout method, service requests and physical water tests/bookings. Collection needs a contact address, not a delivery destination.

Existing and provider-authenticated customers must still sign in and read. Missing details require completing the existing account before these submissions, not creating another account. Preserve carts and form drafts; saved details prefill editable transaction fields.

Addresses are never ownership evidence. Informational guides, Alison chat and anonymous instant assessments do not require an address.

**Why:** The user selected this policy explicitly across account registration, order delivery, service requests and water tests.

**How to apply:** Keep server validation aligned with customer forms, while keeping transaction contact, account identity, fulfillment and payment evidence separate.