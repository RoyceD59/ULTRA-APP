import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogueCache } from "../lib/catalogue-cache.js";

test("ten repeated and concurrent reads share one load (90% fewer upstream reads)", async () => {
  const cache = new CatalogueCache<number[]>();
  let reads = 0;
  const load = async () => {
    reads++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return [1, 2, 101];
  };
  const results = await Promise.all(Array.from({ length: 10 }, () => cache.read("all", load)));
  assert.equal(reads, 1);
  assert.deepEqual(results[9].value, [1, 2, 101]);
  assert.equal(results.filter(r => r.source === "shared").length, 9);
  assert.equal((await cache.read("all", load)).source, "hit");
});

test("expiry, rejection and invalidation never fall back to stale catalogue rows", async () => {
  let clock = 0;
  const cache = new CatalogueCache<number>(30, 2, () => clock);
  await cache.read("all", async () => 1);
  clock = 31;
  await assert.rejects(cache.read("all", async () => { throw new Error("upstream offline"); }));
  assert.equal((await cache.read("all", async () => 2)).value, 2);
  cache.invalidate();
  assert.equal((await cache.read("all", async () => 3)).source, "miss");
});

test("invalidation during a provider read prevents old data repopulating the cache", async () => {
  const cache = new CatalogueCache<number>();
  let resolve!: (value: number) => void;
  const old = cache.read("all", () => new Promise<number>(r => { resolve = r; }));
  cache.invalidate();
  assert.equal((await cache.read("all", async () => 2)).value, 2);
  resolve(1);
  await old;
  assert.equal((await cache.read("all", async () => 3)).value, 2);
});

test("LRU capacity and active variant capacity are bounded", async () => {
  const cache = new CatalogueCache<number>(30_000, 2);
  await cache.read("a", async () => 1);
  await cache.read("b", async () => 2);
  await cache.read("a", async () => 9);
  await cache.read("c", async () => 3);
  assert.equal((await cache.read("b", async () => 4)).source, "miss");
  const pending = new CatalogueCache<number>(30_000, 1);
  let resolve!: (value: number) => void;
  const first = pending.read("a", () => new Promise<number>(r => { resolve = r; }));
  await assert.rejects(pending.read("b", async () => 2), /capacity/);
  resolve(1);
  await first;
});

test("oversized complete catalogues bypass retention rather than being truncated", async () => {
  const cache = new CatalogueCache<number[]>(30_000, 2, Date.now, 4);
  assert.deepEqual((await cache.read("all", async () => [1, 2, 3])).value, [1, 2, 3]);
  assert.equal((await cache.read("all", async () => [1, 2, 3])).source, "miss");
});

test("invalidation cannot reset capacity while old provider requests are still running", async () => {
  const cache = new CatalogueCache<number>(30_000, 1);
  let resolve!: (value: number) => void;
  const old = cache.read("all", () => new Promise<number>(r => { resolve = r; }));
  cache.invalidate();
  cache.invalidate();
  await assert.rejects(cache.read("all", async () => 2), /capacity/);
  resolve(1);
  await old;
  assert.equal((await cache.read("all", async () => 2)).value, 2);
});