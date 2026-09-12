import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
// @ts-ignore — the test stub exposes helpers not present in the package types.
import AsyncStorageStub from "@react-native-async-storage/async-storage";
import {
  PROFILE_DRAFT_RETENTION_MS,
  PROFILE_SESSION_EXPIRED_MESSAGE,
  PROFILE_SIGN_IN_AGAIN_LABEL,
  clearProfileDraft,
  isExpiredProfileSession,
  loadOwnedProfileDraftSafely,
  loadProfileDraft,
  preserveProfileDraftAfterSaveError,
  profileDraftForAccount,
  saveProfileDraft,
  shouldApplyLoadedProfileDraft,
  type ProfileDraftFields,
} from "../profileDraft.ts";
import { resolveReturnTo } from "../authReturn.ts";

const fields = {
  firstName: "Amina",
  lastName: "Kamau",
  phone: "+254712345678",
  address: "Nairobi",
};
const resetStorage: () => void = (AsyncStorageStub as any)._reset;
const storage: Map<string, string> = (AsyncStorageStub as any)._storage;
const setStorageGates = (AsyncStorageStub as any)._setGates as (
  gates: { get?: () => Promise<void> },
) => void;

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
    assert.equal(storage.has("uc_profile_draft"), true);
  });
});

describe("expired profile-save recovery", () => {
  const edited: ProfileDraftFields = {
    firstName: "Amina",
    lastName: "Otieno",
    phone: "+254712345678",
    address: "14 Riverside Drive, Nairobi",
  };

  for (const error of [{ status: 401 }, { status: 403, body: { code: "SESSION_EXPIRED" } }]) {
    it(`recognises an expired ${error.status} and preserves every edited field`, async () => {
      assert.equal(await preserveProfileDraftAfterSaveError(41, edited, error), true);
      assert.deepEqual(await loadProfileDraft(41), edited);
      assert.equal(
        PROFILE_SESSION_EXPIRED_MESSAGE,
        "Your session expired. Sign in again to finish saving these changes.",
      );
      assert.equal(PROFILE_SIGN_IN_AGAIN_LABEL, "Sign in again");
    });
  }

  it("does not mistake the registered-account 403 for session expiry", async () => {
    const error = {
      status: 403,
      body: { error: "Profile update is only available for registered accounts" },
    };
    assert.equal(isExpiredProfileSession(error), false);
    assert.equal(await preserveProfileDraftAfterSaveError(41, edited, error), false);
  });

  it("returns both password and social sign-in to the Account editor", () => {
    const returnTo = resolveReturnTo("/account?editProfile=1");
    assert.equal(returnTo, "/account?editProfile=1");
    assert.equal(returnTo, resolveReturnTo("/account?editProfile=1"));
  });

  it("never applies an owner draft to a different active account", async () => {
    await saveProfileDraft(41, edited);
    const owned = await loadOwnedProfileDraftSafely(41);
    assert.deepEqual(profileDraftForAccount(owned, 41), edited);
    assert.equal(profileDraftForAccount(owned, 99), null);
  });

  it("ignores a delayed owner load after a different account signs in", async () => {
    await saveProfileDraft(41, edited);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    setStorageGates({ get: () => gate });

    const pending = loadOwnedProfileDraftSafely(41);
    const activeAccountId = 99;
    release();
    const stale = await pending;

    assert.equal(shouldApplyLoadedProfileDraft(41, activeAccountId), false);
    assert.equal(profileDraftForAccount(stale, activeAccountId), null);
  });

  it("keeps recovery closed when draft storage cannot be read", async () => {
    setStorageGates({ get: async () => { throw new Error("storage unavailable"); } });
    assert.equal(await loadOwnedProfileDraftSafely(41), null);
  });

  it("clears the recovered draft after a successful save", async () => {
    await saveProfileDraft(41, edited);
    await clearProfileDraft();
    assert.equal(await loadProfileDraft(41), null);
  });
});