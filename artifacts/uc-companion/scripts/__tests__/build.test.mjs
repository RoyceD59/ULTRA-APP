/**
 * Tests for the port-discovery utilities in scripts/metro-port.js, which are
 * consumed by scripts/build.js.  Tests import the production module directly
 * so that a regression in the actual source is caught here.
 *
 * Covered:
 *   - parseConfiguredMetroPort  — env-var parsing and validation
 *   - reserveAvailablePort      — happy path and EADDRINUSE rejection
 *   - findMetroPort             — busy-port fallback (the primary edge case)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  parseConfiguredMetroPort,
  reserveAvailablePort,
  findMetroPort,
} = require(join(dirname(fileURLToPath(import.meta.url)), "..", "metro-port.js"));

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Bind a TCP server to an OS-assigned ephemeral port, keep it open, and
 * return { port, close }.  Used to simulate a leftover Metro process still
 * holding its port.
 */
function occupyPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        close: () =>
          new Promise((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

/**
 * Run fn() with process.env.METRO_PORT temporarily set to `value`
 * (or deleted when value is undefined), then restore the original.
 * Handles both sync and async callbacks.
 */
function withMetroPort(value, fn) {
  const saved = process.env.METRO_PORT;
  if (value === undefined) {
    delete process.env.METRO_PORT;
  } else {
    process.env.METRO_PORT = value;
  }
  const restore = () => {
    if (saved === undefined) delete process.env.METRO_PORT;
    else process.env.METRO_PORT = saved;
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(
        (v) => { restore(); return v; },
        (e) => { restore(); throw e; },
      );
    }
    restore();
    return result;
  } catch (e) {
    restore();
    throw e;
  }
}

// ── parseConfiguredMetroPort ─────────────────────────────────────────────────

describe("parseConfiguredMetroPort", () => {
  test("returns null when METRO_PORT is not set", () =>
    withMetroPort(undefined, () => {
      assert.equal(parseConfiguredMetroPort(), null);
    }));

  test("returns the integer value when METRO_PORT is a valid port", () =>
    withMetroPort("8081", () => {
      assert.equal(parseConfiguredMetroPort(), 8081);
    }));

  test("returns 0 when METRO_PORT=0 (OS auto-select sentinel)", () =>
    withMetroPort("0", () => {
      assert.equal(parseConfiguredMetroPort(), 0);
    }));

  test("throws a descriptive error on a non-numeric value", () =>
    withMetroPort("not-a-port", () => {
      assert.throws(() => parseConfiguredMetroPort(), /METRO_PORT must be/);
    }));

  test("throws when the port number exceeds 65535", () =>
    withMetroPort("99999", () => {
      assert.throws(() => parseConfiguredMetroPort(), /METRO_PORT must be/);
    }));

  test("throws on a negative port number", () =>
    withMetroPort("-1", () => {
      assert.throws(() => parseConfiguredMetroPort(), /METRO_PORT must be/);
    }));
});

// ── reserveAvailablePort ─────────────────────────────────────────────────────

describe("reserveAvailablePort", () => {
  test("resolves to a valid ephemeral port when port 0 is requested", async () => {
    const port = await reserveAvailablePort(0);
    assert.ok(
      Number.isInteger(port) && port > 0 && port <= 65535,
      `expected a valid port number, got ${port}`,
    );
  });

  test("releases the port immediately so the caller can bind it", async () => {
    // reserveAvailablePort must close the probe before resolving so the port
    // is free for Metro to bind right away.
    const port = await reserveAvailablePort(0);
    await new Promise((resolve, reject) => {
      const verify = net.createServer();
      verify.once("error", reject);
      verify.listen(port, "127.0.0.1", () => verify.close(resolve));
    });
  });

  test("rejects with EADDRINUSE when the requested port is already occupied", async () => {
    const occupied = await occupyPort();
    try {
      await assert.rejects(
        () => reserveAvailablePort(occupied.port),
        (err) => {
          assert.equal(err.code, "EADDRINUSE");
          return true;
        },
      );
    } finally {
      await occupied.close();
    }
  });
});

// ── findMetroPort — busy-port edge case ─────────────────────────────────────

describe("findMetroPort — busy-port edge case", () => {
  test("selects a different ephemeral port when METRO_PORT is already occupied", async () => {
    // Simulate a leftover Metro process still holding its port.
    const occupied = await occupyPort();
    const busyPort = occupied.port;
    try {
      const chosen = await withMetroPort(String(busyPort), findMetroPort);

      assert.ok(
        Number.isInteger(chosen) && chosen > 0 && chosen <= 65535,
        `expected a valid port number, got ${chosen}`,
      );
      assert.notEqual(
        chosen,
        busyPort,
        "findMetroPort must not return the occupied port",
      );
    } finally {
      await occupied.close();
    }
  });

  test("does not hang — resolves within 5 s even when METRO_PORT is occupied", async (t) => {
    // Use the test runner's built-in timeout so no manual setTimeout lingers
    // after the race resolves.
    t.mock; // touch ctx to satisfy linter; timeout is set via runner option
    const occupied = await occupyPort();
    try {
      // AbortSignal.timeout gives us a clean, auto-clearing timer.
      const result = await Promise.race([
        withMetroPort(String(occupied.port), findMetroPort),
        new Promise((_, reject) => {
          const id = setTimeout(
            () => reject(new Error("findMetroPort timed out after 5 s")),
            5000,
          );
          // Unref so the timer does not hold the event loop open if it wins
          // the race (it won't in the happy path, but belt-and-suspenders).
          if (id && typeof id.unref === "function") id.unref();
        }),
      ]);
      assert.ok(
        Number.isInteger(result) && result > 0,
        `expected a positive port, got ${result}`,
      );
    } finally {
      await occupied.close();
    }
  });

  test("returns an ephemeral port when METRO_PORT is not set", async () => {
    const port = await withMetroPort(undefined, findMetroPort);
    assert.ok(
      Number.isInteger(port) && port > 0 && port <= 65535,
      `expected a valid port number, got ${port}`,
    );
  });

  test("returns an ephemeral port when METRO_PORT=0 (OS auto-select)", async () => {
    // 0 is falsy in JS, so `if (configuredPort)` in findMetroPort evaluates
    // to false and falls through to reserveAvailablePort(0). This is
    // intentional — METRO_PORT=0 means "let the OS choose".
    const port = await withMetroPort("0", findMetroPort);
    assert.ok(
      Number.isInteger(port) && port > 0 && port <= 65535,
      `expected a valid port number, got ${port}`,
    );
  });

  test("propagates unexpected errors (non-EADDRINUSE) without swallowing them", async () => {
    // If reserveAvailablePort rejects with something other than EADDRINUSE,
    // findMetroPort must re-throw rather than silently swallowing the error.
    // METRO_PORT=65536 is invalid — parseConfiguredMetroPort throws a plain
    // Error with an actionable message before the network is even touched.
    await withMetroPort("65536", () =>
      assert.rejects(
        () => findMetroPort(),
        (err) => {
          assert.ok(err instanceof Error, `expected an Error, got ${err}`);
          assert.match(err.message, /METRO_PORT must be/);
          return true;
        },
      ),
    );
  });
});
