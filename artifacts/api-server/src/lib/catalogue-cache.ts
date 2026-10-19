/**
 * Process-local, bounded cache for normalized PUBLIC Woo catalogue rows only.
 * Never pass customer, order, review or authentication data to this cache.
 * Stock/price snapshots expire after 30s; checkout/detail bypass it.
 */
export class CatalogueCache<T> {
  private entries = new Map<string, { value: T; expires: number; bytes: number }>();
  private pending = new Map<string, Promise<T>>();
  private generation = 0;
  private activeLoads = 0;

  constructor(
    private readonly ttlMs = 30_000,
    private readonly maxEntries = 64,
    private readonly now = Date.now,
    private readonly maxBytes = 16 * 1024 * 1024,
    private readonly maxPending = Math.min(maxEntries, 8),
  ) {}

  invalidate(): void {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }

  async read(key: string, load: () => Promise<T>): Promise<{ value: T; source: string }> {
    const entry = this.entries.get(key);
    if (entry && entry.expires > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      return { value: entry.value, source: "hit" };
    }
    this.entries.delete(key);
    const existing = this.pending.get(key);
    if (existing) return { value: await existing, source: "shared" };
    // Bound concurrent variant requests too, rather than only retained entries.
    if (this.activeLoads >= this.maxPending) throw new Error("Catalogue refresh capacity reached");
    const generation = this.generation;
    const promise = (async () => {
      this.activeLoads++;
      try {
        const value = await load();
        if (this.generation === generation) {
          const bytes = Buffer.byteLength(JSON.stringify(value));
          // Oversized complete responses are returned intact, just not retained.
          if (bytes <= this.maxBytes) {
            this.entries.set(key, { value, expires: this.now() + this.ttlMs, bytes });
          }
          while (this.entries.size > this.maxEntries ||
            [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0) > this.maxBytes) {
            this.entries.delete(this.entries.keys().next().value!);
          }
        }
        return value;
      } finally {
        // Invalidating dedupe entries does not stop old provider requests.
        this.activeLoads--;
      }
    })();
    this.pending.set(key, promise);
    try {
      return { value: await promise, source: "miss" };
    } finally {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    }
  }
}