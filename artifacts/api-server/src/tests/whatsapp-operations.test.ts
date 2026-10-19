import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WhatsAppOperations } from "../lib/whatsapp-operations.js";

describe("WhatsApp reset ordering", () => {
  it("waits for an old restore before cleanup and blocks pairing during reset", async () => {
    let finishRestore!: () => void;
    const events: string[] = [];
    const operations = new WhatsAppOperations(
      async () => {
        events.push("restore");
        await new Promise<void>((resolve) => { finishRestore = resolve; });
        events.push("restored");
      },
      () => { events.push("invalidate"); },
      async () => { events.push("cleanup"); },
    );
    const connection = operations.connect();
    await Promise.resolve();
    const reset = operations.disconnect();
    assert.equal(operations.disconnect(), reset, "concurrent resets share one cleanup");
    await assert.rejects(operations.connect(), /Retry WhatsApp Disconnect/);
    assert.deepEqual(events, ["restore", "invalidate"]);
    finishRestore();
    await Promise.all([connection, reset]);
    assert.deepEqual(events, ["restore", "invalidate", "restored", "cleanup"]);
  });

  it("never starts a queued restore when reset was requested first", async () => {
    let starts = 0;
    let clears = 0;
    const operations = new WhatsAppOperations(
      async () => { starts++; },
      () => {},
      async () => { clears++; },
    );
    await Promise.all([operations.connect(), operations.disconnect()]);
    assert.equal(starts, 0);
    assert.equal(clears, 1);
  });

  it("keeps pairing blocked after failed cleanup until a successful disconnect retry", async () => {
    let fail = true;
    let starts = 0;
    const operations = new WhatsAppOperations(
      async () => { starts++; },
      () => {},
      async () => { if (fail) throw new Error("cleanup failed"); },
    );
    await assert.rejects(operations.disconnect(), /cleanup failed/);
    await assert.rejects(operations.connect(), /Retry WhatsApp Disconnect/);
    assert.equal(starts, 0);
    fail = false;
    await operations.disconnect();
    await operations.connect();
    assert.equal(starts, 1);
  });
});