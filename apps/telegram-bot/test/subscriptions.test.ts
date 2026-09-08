import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubscriptionStore } from "../src/subscriptions";
import type { Address } from "@beacon/cca-sdk";

const AUCTION_A = "0x145A9163d5a89fe843955b1D337F75d46088E156" as Address;
const AUCTION_B = "0xa26DBABBbF9451F150A87d7635f6891474c4F0FA" as Address;

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "beacon-subs-"));
  file = join(dir, "subs.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SubscriptionStore", () => {
  it("starts empty when no file exists", async () => {
    const store = new SubscriptionStore(file);
    expect(await store.isEmpty()).toBe(true);
    expect(await store.allAuctions()).toEqual([]);
  });

  it("registers an auction for one chat only", async () => {
    const store = new SubscriptionStore(file);
    expect(await store.watch("chat-1", AUCTION_A)).toBe(true);

    expect(await store.auctionsFor("chat-1")).toEqual([AUCTION_A]);
    // Another chat must not inherit it - subscriptions are per chat.
    expect(await store.auctionsFor("chat-2")).toEqual([]);
    expect(await store.subscribersOf(AUCTION_A)).toEqual(["chat-1"]);
  });

  it("reports a duplicate watch rather than adding it twice", async () => {
    const store = new SubscriptionStore(file);
    expect(await store.watch("chat-1", AUCTION_A)).toBe(true);
    expect(await store.watch("chat-1", AUCTION_A)).toBe(false);
    expect(await store.auctionsFor("chat-1")).toHaveLength(1);
  });

  it("treats addresses case-insensitively but keeps the checksummed form", async () => {
    const store = new SubscriptionStore(file);
    await store.watch("chat-1", AUCTION_A);

    // A user pasting a lowercase address must not create a second entry.
    expect(await store.watch("chat-1", AUCTION_A.toLowerCase() as Address)).toBe(false);
    expect(await store.auctionsFor("chat-1")).toEqual([AUCTION_A]);
    expect(await store.subscribersOf(AUCTION_A.toLowerCase() as Address)).toEqual(["chat-1"]);
  });

  it("fans one auction out to every subscribed chat", async () => {
    const store = new SubscriptionStore(file);
    await store.watch("chat-1", AUCTION_A);
    await store.watch("chat-2", AUCTION_A);
    await store.watch("chat-2", AUCTION_B);

    expect((await store.subscribersOf(AUCTION_A)).sort()).toEqual(["chat-1", "chat-2"]);
    expect(await store.subscribersOf(AUCTION_B)).toEqual(["chat-2"]);
    // The poll loop reads the union, so each auction is read once, not per chat.
    expect((await store.allAuctions()).sort()).toEqual([AUCTION_A, AUCTION_B].sort());
  });

  it("unwatches only for the requesting chat", async () => {
    const store = new SubscriptionStore(file);
    await store.watch("chat-1", AUCTION_A);
    await store.watch("chat-2", AUCTION_A);

    expect(await store.unwatch("chat-1", AUCTION_A)).toBe(true);
    expect(await store.subscribersOf(AUCTION_A)).toEqual(["chat-2"]);
    expect(await store.unwatch("chat-1", AUCTION_A)).toBe(false);
  });

  it("persists across restarts", async () => {
    const first = new SubscriptionStore(file);
    await first.watch("chat-1", AUCTION_A);
    await first.watch("chat-2", AUCTION_B);

    const second = new SubscriptionStore(file);
    expect(await second.auctionsFor("chat-1")).toEqual([AUCTION_A]);
    expect(await second.auctionsFor("chat-2")).toEqual([AUCTION_B]);
  });

  it("writes readable JSON", async () => {
    const store = new SubscriptionStore(file);
    await store.watch("chat-1", AUCTION_A);

    const parsed = JSON.parse(await readFile(file, "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.chats["chat-1"].auctions).toEqual([AUCTION_A]);
  });

  it("drops a chat entirely once its last auction is removed", async () => {
    const store = new SubscriptionStore(file);
    await store.watch("chat-1", AUCTION_A);
    await store.unwatch("chat-1", AUCTION_A);

    expect(await store.isEmpty()).toBe(true);
    expect(await store.allChats()).toEqual([]);
  });
});
