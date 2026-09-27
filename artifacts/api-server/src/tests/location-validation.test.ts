import assert from "node:assert/strict";
import test from "node:test";
import { locationInput } from "../routes/uc.js";

const validLocation = {
  type: "vendor",
  name: "Clear Water Vendor",
  address: "Nairobi",
  latitude: -1.286,
  longitude: 36.817,
  hours: "Mon–Sat 08:00–18:00",
  phone: "+254700000000",
  vendorName: "Clear Water Ltd",
};
test("managed locations accept all supported fields", () => {
  assert.deepEqual(locationInput(validLocation), validLocation);
});

test("managed locations reject unsupported types and coordinates outside global bounds", () => {
  assert.equal(locationInput({ ...validLocation, type: "unapproved" }), null);
  assert.equal(locationInput({ ...validLocation, latitude: 90.001 }), null);
  assert.equal(locationInput({ ...validLocation, longitude: -180.001 }), null);
});

test("partial location updates can change active state without resending identity fields", () => {
  assert.deepEqual(locationInput({ active: false }, true), {
    type: "",
    name: "",
    address: "",
    latitude: Number.NaN,
    longitude: Number.NaN,
    hours: "",
    phone: null,
    vendorName: null,
  });
});

test("partial location updates reject blank identity and malformed coordinate fields", () => {
  assert.equal(locationInput({ name: "" }, true), null);
  assert.equal(locationInput({ address: null }, true), null);
  assert.equal(locationInput({ hours: 42 }, true), null);
  assert.equal(locationInput({ latitude: null }, true), null);
  assert.equal(locationInput({ longitude: "" }, true), null);
  assert.equal(locationInput({ latitude: "Infinity" }, true), null);
  assert.equal(locationInput({ longitude: "NaN" }, true), null);
});
