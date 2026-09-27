# Dynamic Redemption Conversion and Promotions

## Purpose

Make rewards redemption conversion fully database-configurable and add one
admin-managed promotion system that supports points bonuses, redemption boosts,
and checkout discounts. Customers can enter eligible codes in Companion
checkout and redemption flows, while staff can apply eligible codes after
resolving a customer in ProjectHub.

## Redemption conversion

- The default conversion is stored in the database rather than application code.
- The configured primary ProjectHub admin can select:
  - fixed KES value per 1,000 points; or
  - percentage-based redemption value.
- Redemptions remain limited to positive whole 1,000-point blocks and cannot
  exceed the customer's points balance.
- Each redemption ledger entry stores the conversion mode and value used.
  Changing the current rate never changes historical redemptions.
- Clients display conversion previews, but the server calculates and validates
  the final value.

## Promotion model

Each promotion has:

- a unique, case-insensitive code;
- one type: `bonus_points`, `redemption_boost`, or `checkout_discount`;
- an effect mode appropriate to its type (`fixed` or `percentage`);
- a positive effect value;
- zero or more eligible products, where no products means all products;
- a start time and optional end time;
- an active state;
- an optional global use limit;
- an optional per-customer use limit;
- creation and update timestamps and server-derived staff actors.

Changing a promotion affects future uses only. Existing promotion uses retain a
snapshot of the type, mode, value, and calculated benefit.

## Promotion behavior

### Bonus points

- Applies after an eligible qualifying purchase or staff-assisted rewards action.
- Adds a separate positive entry to the existing rewards ledger.
- The server calculates the bonus; clients never submit the awarded amount.

### Redemption boost

- Applies only during a valid rewards redemption.
- Improves the configured default redemption conversion for that transaction.
- It does not change the customer's points balance calculation or bypass the
  1,000-point block rule.

### Checkout discount

- Applies to eligible products during Companion checkout.
- Supports fixed KES or percentage discounts.
- A discount cannot reduce an eligible subtotal below zero.
- The server-calculated discount and promotion-use reference are persisted with
  the order/payment data before payment initialization.

## Application channels

- Companion accepts promotion codes in checkout and redemption interfaces.
- ProjectHub staff can apply promotion codes after scanning or manually resolving
  a customer.
- The same server validation runs for both channels.
- Staff application records the authenticated staff actor. Customer application
  records the authenticated Companion account.

## Validation and concurrency

The server validates:

- code existence and case-insensitive normalization;
- active state and activation window;
- promotion type versus requested operation;
- eligible products;
- positive values and valid percentage bounds;
- global and per-customer limits;
- customer/account status;
- points balance and redemption block constraints.

Promotion application is transactional and idempotent. A concurrent final use
cannot exceed a usage limit, and a retried request cannot grant a duplicate
benefit. A code is counted as used only when its associated points,
redemption, or order operation commits successfully.

## Administration

ProjectHub provides:

- current redemption conversion and a primary-admin-only editor;
- promotion list with active, scheduled, expired, and disabled states;
- create and edit forms for code, type, value, products, activation period, and
  usage limits;
- activate/deactivate controls;
- usage totals and a privacy-safe audit view.

The API derives the admin identity from the verified ProjectHub session. It
does not trust client-supplied actor names.

## Audit and privacy

- Promotion uses record customer, operation/order reference, actor, idempotency
  key, and effect snapshot.
- Administrative changes record server-derived actor and timestamp.
- Promotion reports mask customer contact details and never expose QR tokens.
- QR, account, and payment identifiers are not included in share content.

## Failure behavior

- Invalid, expired, ineligible, or exhausted codes return a clear non-retryable
  validation response.
- Temporary database/provider failures do not consume a promotion use.
- Payment initialization fails explicitly if the order discount cannot be
  persisted consistently.
- A failed notification never rolls back a committed reward, redemption, or
  promotion use.

## Testing

Coverage includes:

- primary-admin conversion authorization and historical snapshots;
- promotion activation boundaries and case-insensitive uniqueness;
- product eligibility and discount floors;
- global/per-customer usage-limit races;
- idempotent retries;
- bonus-points and redemption-boost ledger behavior;
- checkout price calculations and payment initialization;
- customer and staff application paths;
- privacy-safe responses and audit records.

## Out of scope

- Automatically importing WooCommerce-created coupons into this promotion
  system.
- Public promotion discovery or marketing campaigns.
- Combining multiple promotion codes in one transaction.
- Cashback, cash payouts, or customer-to-customer code transfers.