import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile as readSource } from "node:fs/promises";
import { syncSessionFiles, uploadFailureCategory, SESSION_UPLOAD_BACKOFF_MS,
  type SessionSyncDependencies, type SessionSyncEvent } from "../lib/whatsapp-session-sync.js";
import { WhatsAppOperations } from "../lib/whatsapp-operations.js";

const networkError = () => Object.assign(new Error("PRIVATE_ERROR_CONTENTS_AND_URL"), { code: "ECONNRESET" });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(overrides: Partial<SessionSyncDependencies> = {}) {
  const controller = new AbortController();
  const events: SessionSyncEvent[] = [];
  const waits: number[] = [];
  const saved = new Map<string, Uint8Array>();
  const deps: SessionSyncDependencies = {
    signal: controller.signal,
    isCurrent: () => true,
    listFiles: async () => ["private-fixture-file"],
    readFile: async () => Buffer.from("PRIVATE_SYNTHETIC_BYTES"),
    saveFile: async (name, contents) => { saved.set(name, contents); },
    log: event => { events.push(event); },
    wait: async delay => { waits.push(delay); },
    ...overrides,
  };
  return { deps, controller, events, waits, saved };
}

describe("WhatsApp isolated credential backup retry", () => {
  it("recovers a transient failure without another credential event", async () => {
    let calls = 0;
    const test = fixture({ saveFile: async () => { if (++calls === 1) throw networkError(); } });
    assert.deepEqual(await syncSessionFiles(test.deps), { uploaded: 1, failed: 0, obsolete: 0 });
    assert.equal(calls, 2);
    assert.deepEqual(test.waits, [1_000]);
    assert.deepEqual(test.events.map(event => event.status), ["retrying", "recovered"]);
  });

  it("retries only the failed file, not the successful sibling", async () => {
    const attempts = new Map<string, number>();
    const test = fixture({
      listFiles: async () => ["good", "flaky"],
      saveFile: async name => {
        attempts.set(name, (attempts.get(name) ?? 0) + 1);
        if (name === "flaky" && attempts.get(name) === 1) throw networkError();
      },
    });
    assert.deepEqual(await syncSessionFiles(test.deps), { uploaded: 2, failed: 0, obsolete: 0 });
    assert.equal(attempts.get("good"), 1);
    assert.equal(attempts.get("flaky"), 2);
  });

  it("stops after exactly four failed save calls with bounded backoff", async () => {
    let calls = 0;
    const test = fixture({ saveFile: async () => { calls++; throw networkError(); } });
    assert.deepEqual(await syncSessionFiles(test.deps), { uploaded: 0, failed: 1, obsolete: 0 });
    assert.equal(calls, 4);
    assert.deepEqual(test.waits, [1_000, 2_000, 4_000]);
    assert.equal(test.events.at(-1)?.status, "failed");
    assert.equal(test.events.at(-1)?.attempt, 4);
    assert.equal(Object.isFrozen(SESSION_UPLOAD_BACKOFF_MS), true);
  });

  it("does not retry permission, certificate, configuration or unknown errors", async () => {
    for (const error of [
      { code: 403 }, { response: { status: 401 } }, { code: 404 },
      { code: "CERT_HAS_EXPIRED" }, { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" },
      { code: "ENOTFOUND" }, new Error("PRIVATE_UNKNOWN"),
    ]) {
      let calls = 0;
      const test = fixture({ saveFile: async () => { calls++; throw error; } });
      assert.equal((await syncSessionFiles(test.deps)).failed, 1);
      assert.equal(calls, 1);
      assert.deepEqual(test.waits, []);
      assert.equal(test.events[0].category, "permanent");
    }
  });

  it("classifies transient network/TLS, nested causes, timeouts, rate limits and 5xx", () => {
    for (const code of ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPROTO",
      "ERR_SSL_UNEXPECTED_EOF_WHILE_READING", "UND_ERR_SOCKET"]) {
      assert.equal(uploadFailureCategory({ code }), "network");
      assert.equal(uploadFailureCategory({ cause: { code } }), "network");
    }
    assert.equal(uploadFailureCategory({ code: 429 }), "rate_limit");
    assert.equal(uploadFailureCategory({ response: { status: 408 } }), "request_timeout");
    assert.equal(uploadFailureCategory({ statusCode: 503 }), "server");
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    assert.equal(uploadFailureCategory(cycle), "permanent");
  });

  it("re-reads local bytes before retrying the same file", async () => {
    let reads = 0;
    const contents: string[] = [];
    const test = fixture({
      readFile: async () => Buffer.from(++reads === 1 ? "old-fixture" : "new-fixture"),
      saveFile: async (_name, bytes) => {
        contents.push(Buffer.from(bytes).toString());
        if (contents.length === 1) throw networkError();
      },
    });
    assert.equal((await syncSessionFiles(test.deps)).uploaded, 1);
    assert.deepEqual(contents, ["old-fixture", "new-fixture"]);
  });

  it("keeps raw errors, contents, filenames and paths out of structured events", async () => {
    const test = fixture({
      listFiles: async () => ["PRIVATE_FILENAME"],
      saveFile: async () => { throw networkError(); },
    });
    await syncSessionFiles(test.deps);
    const logs = JSON.stringify(test.events);
    assert.doesNotMatch(logs, /PRIVATE_|creds\.json|https:|bucket|token|path|stack|message/);
    for (const event of test.events) {
      assert.ok(Object.keys(event).every(key => ["operation", "status", "attempt", "category", "delayMs"].includes(key)));
    }
  });

  it("does not read/save for an already obsolete or cancelled lifecycle", async () => {
    for (const cancelled of [false, true]) {
      let calls = 0;
      const test = fixture({ isCurrent: () => cancelled,
        listFiles: async () => { calls++; return []; } });
      if (cancelled) test.controller.abort();
      await syncSessionFiles(test.deps);
      assert.equal(calls, 0);
    }
  });

  it("does not admit an upload if generation changes while the file is read", async () => {
    let current = true, saves = 0;
    const test = fixture({ isCurrent: () => current,
      readFile: async () => { current = false; return Buffer.from("fixture"); },
      saveFile: async () => { saves++; } });
    assert.equal((await syncSessionFiles(test.deps)).obsolete, 1);
    assert.equal(saves, 0);
  });

  it("checks generation again after backoff, without relying on cancellation alone", async () => {
    let current = true, calls = 0;
    const test = fixture({ isCurrent: () => current,
      saveFile: async () => { calls++; throw networkError(); },
      wait: async () => { current = false; } });
    assert.equal((await syncSessionFiles(test.deps)).obsolete, 1);
    assert.equal(calls, 1);
  });

  it("does not report recovery from a save completing after lifecycle invalidation", async () => {
    let current = true, calls = 0;
    const test = fixture({ isCurrent: () => current,
      saveFile: async () => {
        if (++calls === 1) throw networkError();
        current = false;
      } });
    assert.equal((await syncSessionFiles(test.deps)).obsolete, 1);
    assert.equal(calls, 2);
    assert.ok(test.events.every(event => event.status !== "recovered"));
  });

  it("cancels the real backoff promptly without starting a later upload", async () => {
    let calls = 0;
    const retryStarted = deferred();
    const test = fixture({ saveFile: async () => { calls++; throw networkError(); },
      log: event => { if (event.status === "retrying") retryStarted.resolve(); } });
    delete test.deps.wait; // Exercise cancellable production timers, not a fake sleep.
    const sync = syncSessionFiles(test.deps);
    await retryStarted.promise;
    test.controller.abort();
    assert.equal((await sync).obsolete, 1);
    assert.equal(calls, 1);
  });

  it("waits for every admitted write when another upload permanently fails", async () => {
    const admitted = deferred(), finish = deferred();
    let settled = false;
    const test = fixture({ listFiles: async () => ["fails", "slow"],
      saveFile: async name => {
        if (name === "fails") throw { code: 403 };
        admitted.resolve();
        await finish.promise;
      } });
    const syncing = syncSessionFiles(test.deps).then(value => { settled = true; return value; });
    await admitted.promise;
    await Promise.resolve();
    assert.equal(settled, false);
    finish.resolve();
    assert.deepEqual(await syncing, { uploaded: 1, failed: 1, obsolete: 0 });
  });

  it("Disconnect waits for active writes, then clears all isolated stored files", async () => {
    let generation = 1;
    const admitted = deferred(), finish = deferred();
    const storage = new Map<string, Uint8Array>();
    const test = fixture({ listFiles: async () => ["fails", "slow"],
      isCurrent: () => generation === 1,
      saveFile: async (name, bytes) => {
        if (name === "fails") throw { code: 403 };
        admitted.resolve();
        await finish.promise;
        storage.set(name, bytes);
      } });
    const queue = syncSessionFiles(test.deps);
    await admitted.promise;
    let cleared = false;
    const operations = new WhatsAppOperations(async () => {}, () => {
      generation++;
      test.controller.abort();
    }, async () => {
      await queue;
      storage.clear();
      cleared = true;
    });
    const reset = operations.disconnect();
    await Promise.resolve();
    assert.equal(cleared, false);
    await assert.rejects(operations.connect(), /Retry WhatsApp Disconnect/);
    finish.resolve();
    await reset;
    assert.equal(cleared, true);
    assert.equal(storage.size, 0);
    await Promise.resolve();
    assert.equal(storage.size, 0, "no detached write may resurrect the stored session");
  });

  it("Disconnect during retry sleep stops retries before clearing isolated storage", async () => {
    let generation = 1, calls = 0;
    const retryStarted = deferred();
    const test = fixture({ isCurrent: () => generation === 1,
      saveFile: async () => { calls++; throw networkError(); },
      log: event => { if (event.status === "retrying") retryStarted.resolve(); } });
    delete test.deps.wait;
    const queue = syncSessionFiles(test.deps);
    await retryStarted.promise;
    const operations = new WhatsAppOperations(async () => {}, () => {
      generation++; test.controller.abort();
    }, async () => { await queue; test.saved.clear(); });
    await operations.disconnect();
    assert.equal(calls, 1);
    assert.equal(test.saved.size, 0);
  });

  it("leaves missing auth directories harmless but reports other filesystem failures", async () => {
    const missing = fixture({ listFiles: async () => { throw { code: "ENOENT" }; } });
    assert.deepEqual(await syncSessionFiles(missing.deps), { uploaded: 0, failed: 0, obsolete: 0 });
    assert.equal(missing.events.length, 0);
    const denied = fixture({ listFiles: async () => { throw new Error("PRIVATE_FS_ERROR"); } });
    assert.equal((await syncSessionFiles(denied.deps)).failed, 1);
    assert.doesNotMatch(JSON.stringify(denied.events), /PRIVATE_/);
    let writes = 0;
    const unreadable = fixture({ readFile: async () => { throw new Error("PRIVATE_FS"); },
      saveFile: async () => { writes++; } });
    assert.equal((await syncSessionFiles(unreadable.deps)).failed, 1);
    assert.equal(writes, 0);
  });

  it("production wiring retains queue drain and invalidates backoff with the lifecycle", async () => {
    // Static integration check avoids importing the live session/storage module.
    const source = await readSource(new URL("../lib/whatsapp.ts", import.meta.url), "utf8");
    assert.match(source, /await syncToObjectStorage\(generation, backupSignal\)/);
    assert.match(source, /isCurrent: \(\) => generation === lifecycleGeneration/);
    const invalidate = source.slice(source.indexOf("function invalidateSession"), source.indexOf("async function clearWhatsAppSession"));
    assert.match(invalidate, /lifecycleGeneration\+\+;\s+sessionBackupAbort\.abort\(\)/);
    const cleanup = source.slice(source.indexOf("async function clearWhatsAppSession"));
    assert.ok(cleanup.indexOf("await sessionSyncQueue") < cleanup.indexOf("clearStoredSession()"));
    assert.match(source, /await syncSessionFiles\(/);
  });
});
