interface Entry {
  value: Promise<unknown>;
  expires: number;
}

/** Per-process limits complement CDN caching; they are not a distributed rate limiter. */
export class ReadCache {
  private readonly entries = new Map<string, Entry>();
  private active = 0;
  constructor(
    private readonly options = {
      capacity: 2_000,
      maxConcurrent: 20,
      ttlMs: 15_000,
      failureTtlMs: 2_000,
    },
    private readonly now = Date.now,
  ) {}
  get size() {
    return this.entries.size;
  }

  get<T>(key: string, read: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value as Promise<T>;
    }
    this.entries.delete(key);
    if (this.active >= this.options.maxConcurrent)
      return Promise.reject(new Error("Auction reads are busy. Please retry shortly."));
    this.active++;
    const value = Promise.resolve().then(read);
    const entry: Entry = { value, expires: Infinity };
    this.entries.set(key, entry);
    while (this.entries.size > this.options.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    void value.then(
      () => {
        this.active--;
        entry.expires = this.now() + this.options.ttlMs;
      },
      () => {
        this.active--;
        entry.expires = this.now() + this.options.failureTtlMs;
      },
    );
    return value;
  }
}
