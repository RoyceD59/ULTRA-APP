import { randomUUID } from "node:crypto";
import { before } from "node:test";
import { appCatalogueFixture } from "./app-catalogue.js";

let productId: number;
before(async () => { productId = (await appCatalogueFixture()).id; });

/** App-owned checkout: amounts must come from the cart, never caller money. */
export function paymentCheckoutFixture(phone = "+254712345678") {
  if (!productId) throw new Error("Payment catalogue fixture has not been initialized");
  return {
    idempotencyKey: randomUUID(), fulfillment: "collection",
    lineItems: [{ productId, quantity: 1 }], quotedTotal: 3499,
    shippingAddress: { firstName: "Amina", lastName: "Otieno",
      phone, address1: "Test building, Nairobi", city: "Nairobi", country: "KE" },
  };
}