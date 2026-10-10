import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "viem";
import type { Address } from "@hammerock/cca-sdk";

export interface AuctionWatch {
  auction: Address;
  chainId?: number;
}
export interface ChatSubscription {
  chatId: string;
  auctions: Address[];
}
type Chats = Map<string, Map<string, AuctionWatch>>;
const keyOf = (watch: AuctionWatch) => `${watch.chainId ?? 0}:${watch.auction.toLowerCase()}`;
const matches = (watch: AuctionWatch, address: Address, chainId?: number) =>
  watch.auction.toLowerCase() === address.toLowerCase() &&
  (chainId === undefined || watch.chainId === chainId);

/** One worker owns this file. Writes are serialized and atomically replaced. */
export class SubscriptionStore {
  private chats: Chats = new Map();
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly filePath: string,
    private readonly maxPerChat = 20,
  ) {}

  load(): Promise<void> {
    this.loading ??= this.read();
    return this.loading;
  }
  private async read(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed = JSON.parse(raw) as {
      version?: number;
      chats?: Record<string, { auctions?: unknown[]; watches?: unknown[] }>;
      chains?: Record<string, number>;
    };
    if (
      ![1, 2].includes(parsed.version ?? 0) ||
      !parsed.chats ||
      typeof parsed.chats !== "object" ||
      Array.isArray(parsed.chats)
    ) {
      throw new Error(
        "Invalid subscriptions file; restore it from backup before starting the bot.",
      );
    }
    const next: Chats = new Map();
    for (const [chatId, entry] of Object.entries(parsed.chats)) {
      const watches = new Map<string, AuctionWatch>();
      const entries = parsed.version === 1 ? entry?.auctions : entry?.watches;
      if (!Array.isArray(entries))
        throw new Error("Invalid subscription entry; existing file was not changed.");
      for (const value of entries) {
        const candidate =
          parsed.version === 1
            ? {
                auction: value,
                chainId:
                  typeof value === "string" ? parsed.chains?.[value.toLowerCase()] : undefined,
              }
            : (value as Partial<AuctionWatch>);
        if (
          !candidate ||
          typeof candidate.auction !== "string" ||
          !isAddress(candidate.auction) ||
          (candidate.chainId !== undefined &&
            (!Number.isSafeInteger(candidate.chainId) || candidate.chainId <= 0))
        ) {
          throw new Error("Invalid auction subscription; existing file was not changed.");
        }
        const watch = { auction: getAddress(candidate.auction), chainId: candidate.chainId };
        watches.set(keyOf(watch), watch);
      }
      if (watches.size) next.set(chatId, watches);
    }
    this.chats = next;
  }
  private async change<T>(mutate: (next: Chats) => T): Promise<T> {
    await this.load();
    const operation = this.queue.then(async () => {
      const next = new Map([...this.chats].map(([chat, watches]) => [chat, new Map(watches)]));
      const result = mutate(next);
      const chats = Object.fromEntries(
        [...next].map(([chat, watches]) => [chat, { watches: [...watches.values()] }]),
      );
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 2, chats }, null, 2) + "\n", {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, this.filePath);
      } finally {
        await rm(temporary, { force: true });
      }
      this.chats = next;
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private async ready() {
    await this.load();
    await this.queue;
  }

  async watch(chatId: string, auction: Address, chainId?: number): Promise<boolean> {
    if (
      !isAddress(auction) ||
      (chainId !== undefined && (!Number.isSafeInteger(chainId) || chainId <= 0))
    )
      throw new Error("Invalid auction or chain.");
    return this.change((next) => {
      const watch = { auction: getAddress(auction), chainId };
      const watches = next.get(chatId) ?? new Map<string, AuctionWatch>();
      const key = keyOf(watch);
      if (watches.has(key)) return false;
      if (watches.size >= this.maxPerChat)
        throw new Error(
          `This chat can follow up to ${this.maxPerChat} auctions. Use /unwatch to make room.`,
        );
      watches.set(key, watch);
      next.set(chatId, watches);
      return true;
    });
  }
  async unwatch(chatId: string, auction: Address, chainId?: number): Promise<boolean> {
    return this.change((next) => {
      const watches = next.get(chatId);
      if (!watches) return false;
      const targets = [...watches].filter(([, watch]) => matches(watch, auction, chainId));
      if (targets.length > 1 && chainId === undefined)
        throw new Error(
          "This address is watched on more than one chain. Use /unwatch <address> <chain>.",
        );
      for (const [key] of targets) watches.delete(key);
      if (!watches.size) next.delete(chatId);
      return targets.length > 0;
    });
  }
  async watchesFor(chatId: string): Promise<AuctionWatch[]> {
    await this.ready();
    return [...(this.chats.get(chatId)?.values() ?? [])];
  }
  async allWatches(): Promise<AuctionWatch[]> {
    await this.ready();
    return [...new Map([...this.chats.values()].flatMap((watches) => [...watches])).values()];
  }
  async auctionsFor(chatId: string): Promise<Address[]> {
    return [...new Set((await this.watchesFor(chatId)).map((w) => w.auction))];
  }
  async allAuctions(): Promise<Address[]> {
    return [...new Set((await this.allWatches()).map((w) => w.auction))];
  }
  async subscribersOf(auction: Address, chainId?: number): Promise<string[]> {
    await this.ready();
    return [...this.chats]
      .filter(([, watches]) => [...watches.values()].some((w) => matches(w, auction, chainId)))
      .map(([chat]) => chat);
  }
  async allChats(): Promise<ChatSubscription[]> {
    await this.ready();
    return [...this.chats].map(([chatId, watches]) => ({
      chatId,
      auctions: [...watches.values()].map((w) => w.auction),
    }));
  }
  async chainOf(auction: Address): Promise<number | undefined> {
    const chains = new Set(
      (await this.allWatches()).filter((w) => matches(w, auction)).map((w) => w.chainId),
    );
    return chains.size === 1 ? [...chains][0] : undefined;
  }
  async setChain(auction: Address, chainId: number): Promise<void> {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid chain.");
    await this.change((next) => {
      for (const watches of next.values()) {
        for (const [key, watch] of watches) {
          if (!matches(watch, auction) || watch.chainId !== undefined) continue;
          watches.delete(key);
          const updated = { ...watch, chainId };
          watches.set(keyOf(updated), updated);
        }
      }
    });
  }
  async isEmpty(): Promise<boolean> {
    await this.ready();
    return this.chats.size === 0;
  }
}
