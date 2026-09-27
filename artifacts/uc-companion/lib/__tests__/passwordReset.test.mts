import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getResetRequestError,
  readResetTokenParam,
} from "../passwordReset.ts";

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


describe("Companion forgot-password errors", () => {
  it("shows the API wait message when the 11th reset-link request returns HTTP 429", () => {
    const response = {
      status: 429,
      body: {
        error: "Too many attempts. Please wait a minute before trying again.",
      },
    };

    assert.equal(
      getResetRequestError(response.status, response.body),
      response.body.error,
    );
  });

  it("uses a friendly wait message instead of a blank error for HTTP 429", () => {
    assert.equal(
      getResetRequestError(429, { error: "" }),
      "Too many attempts. Please wait a minute before trying again.",
    );
  });
});