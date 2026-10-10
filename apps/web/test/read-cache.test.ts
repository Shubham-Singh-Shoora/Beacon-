import { describe, expect, it, vi } from "vitest";
import { ReadCache } from "../lib/read-cache";

describe("shared auction reads", () => {
  it("coalesces simultaneous requests and retries after expiry", async () => {
    let now = 0;
    const cache = new ReadCache(
      { capacity: 2, maxConcurrent: 2, ttlMs: 15, failureTtlMs: 2 },
      () => now,
    );
    const read = vi.fn(async () => 42);
    expect(await Promise.all([cache.get("a", read), cache.get("a", read)])).toEqual([42, 42]);
    expect(read).toHaveBeenCalledTimes(1);
    now = 16;
    await cache.get("a", read);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("bounds memory even when every cached entry is still fresh", async () => {
    const cache = new ReadCache({ capacity: 2, maxConcurrent: 2, ttlMs: 1000, failureTtlMs: 2 });
    for (let i = 0; i < 30; i++) await cache.get(String(i), async () => i);
    expect(cache.size).toBe(2);
  });
  it("briefly shares failures rather than hammering an unavailable provider", async () => {
    let now = 0;
    const cache = new ReadCache(
      { capacity: 2, maxConcurrent: 2, ttlMs: 15, failureTtlMs: 2 },
      () => now,
    );
    const read = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(cache.get("a", read)).rejects.toThrow("offline");
    await expect(cache.get("a", read)).rejects.toThrow("offline");
    expect(read).toHaveBeenCalledTimes(1);
    now = 3;
    await expect(cache.get("a", read)).rejects.toThrow("offline");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("keeps a concurrency limit until an actual provider read settles", async () => {
    const cache = new ReadCache({ capacity: 2, maxConcurrent: 1, ttlMs: 15, failureTtlMs: 2 });
    let finish!: (value: number) => void;
    const waiting = cache.get(
      "a",
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const other = vi.fn(async () => 2);
    await expect(cache.get("b", other)).rejects.toThrow("busy");
    expect(other).not.toHaveBeenCalled();
    finish(1);
    expect(await waiting).toBe(1);
    expect(await cache.get("b", other)).toBe(2);
  });
});
