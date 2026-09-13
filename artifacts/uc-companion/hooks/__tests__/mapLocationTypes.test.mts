import assert from "node:assert/strict";
import test from "node:test";
import type { MapLocation } from "../../hooks/useApi";

test("verified vendor locations are a supported public map location type", () => {
  const vendor: MapLocation = {
    id: "vendor-1",
    type: "vendor",
    name: "Verified Water Shop",
    address: "Nairobi",
    lat: -1.29,
    lng: 36.82,
    hours: "09:00–17:00",
    phone: null,
    vendorName: "Verified Water Shop",
  };

  assert.equal(vendor.type, "vendor");
  assert.equal(vendor.vendorName, "Verified Water Shop");
  assert.equal(vendor.phone, null);
});