import { randomUUID } from "node:crypto";

/** Demo-catalogue checkout: amounts must come from the cart, never caller money. */
export function paymentCheckoutFixture(phone = "+254712345678") {
  return {
    idempotencyKey: randomUUID(), fulfillment: "collection",
    lineItems: [{ productId: 1, quantity: 1 }], quotedTotal: 3499,
    shippingAddress: { firstName: "Amina", lastName: "Otieno",
      phone, address1: "Test building, Nairobi", city: "Nairobi", country: "KE" },
  };
}