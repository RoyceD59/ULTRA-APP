import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readResetTokenParam } from "../passwordReset.ts";

describe("Companion password-reset deep links", () => {
  it("passes a resetToken query value through to the reset screen", () => {
    const rawToken = "8e7c2a4b-1b1f-4e8e-a5d5-2d6cb3d5f4b1";
    assert.equal(readResetTokenParam(rawToken), rawToken);
  });

  it("does not enter reset mode for missing or repeated query parameters", () => {
    assert.equal(readResetTokenParam(undefined), "");
    assert.equal(readResetTokenParam(["unexpected", "value"]), "");
  });
});