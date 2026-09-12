import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
// @ts-ignore — the test stub exposes helpers not present in the package types.
import AsyncStorageStub from "@react-native-async-storage/async-storage";
import {
  PROFILE_DRAFT_RETENTION_MS,
  loadProfileDraft,
  saveProfileDraft,
} from "../profileDraft.ts";

const fields = {
  firstName: "Amina",
  lastName: "Kamau",
  phone: "+254712345678",
  address: "Nairobi",
};
const resetStorage: () => void = (AsyncStorageStub as any)._reset;
const storage: Map<string, string> = (AsyncStorageStub as any)._storage;

beforeEach(() => {
  resetStorage();
});

describe("profile draft retention", () => {
  it("restores a fresh draft for the same account", async () => {
    await saveProfileDraft(42, fields, 1_000);
    assert.deepEqual(await loadProfileDraft(42, 1_000 + PROFILE_DRAFT_RETENTION_MS), fields);
  });

  it("discards an expired draft", async () => {
    await saveProfileDraft(42, fields, 1_000);
    assert.equal(
      await loadProfileDraft(42, 1_001 + PROFILE_DRAFT_RETENTION_MS),
      null,
    );
    assert.equal(storage.has("uc_profile_draft"), false);
  });

  it("discards malformed stored data", async () => {
    storage.set("uc_profile_draft", JSON.stringify({
      accountId: 42,
      updatedAt: "yesterday",
      fields,
    }));
    assert.equal(await loadProfileDraft(42, 2_000), null);
    assert.equal(storage.has("uc_profile_draft"), false);
  });

  it("does not restore another account's draft", async () => {
    await saveProfileDraft(42, fields, 1_000);
    assert.equal(await loadProfileDraft(99, 2_000), null);
    assert.equal(storage.has("uc_profile_draft"), false);
  });
});