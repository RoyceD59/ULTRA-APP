import test from "node:test";
import assert from "node:assert/strict";
import { productVideoSlots } from "./product-video-slots.js";

const clip = (id: number, position: number) => ({ id, type: "video", position });
test("empty products have two empty slots; photos do not consume slots", () => {
  assert.deepEqual(productVideoSlots([{ id: 1, type: "photo", position: 1 }]), [null, null]);
});
test("slots are independent and removing video one retains video two's number", () => {
  const one = clip(1, 1), two = clip(2, 2);
  assert.deepEqual(productVideoSlots([two, one]), [one, two]);
  assert.deepEqual(productVideoSlots([two]), [null, two]);
});
test("legacy clips fill free slots deterministically without modifying rows", () => {
  const older = clip(1, 0), newer = clip(2, 0), explicit = clip(3, 2);
  assert.deepEqual(productVideoSlots([newer, older]), [older, newer]);
  assert.deepEqual(productVideoSlots([older, explicit]), [older, explicit]);
  assert.equal(older.position, 0);
});
test("overflow is not projected and duplicate positions cannot overwrite a clip", () => {
  const one = clip(1, 1), duplicate = clip(2, 1), extra = clip(3, 0);
  assert.deepEqual(productVideoSlots([one, duplicate]), [one, duplicate]);
  assert.equal(productVideoSlots([one, duplicate, extra]).filter(Boolean).length, 2);
});
