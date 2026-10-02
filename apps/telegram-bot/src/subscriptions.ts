/**
 * Per-chat auction subscriptions.
 *
 * Who gets alerted about what is a property of the CHAT, not of the process.
 * A user registers auctions with `/watch <address>` and those survive restarts,
 * so the bot is usable by more than the person holding the .env file.
 *
 * `BEACON_WATCH_AUCTION_ADDRESS` remains only as a dev/testing seed.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getAddress } from "viem";
import type { Address } from "@hammerock/cca-sdk";

export interface ChatSubscription {
  chatId: string;
  auctions: Address[];
}

interface SerializedFile {
  version: 1;
  chats: Record<string, { auctions: string[] }>;
  /**
   * Which chain each watched auction is on (lowercase address -> chain id).
   * Optional: files written before multi-chain have none, and those auctions
   * are matched to a chain from the stores at startup.
   */
  chains?: Record<string, number>;
}

function normalise(address: Address): string {
  return address.toLowerCase();
}

/**
 * Always display the EIP-55 checksummed form, whatever case the user typed.
 * Without this, watching an auction with a lowercase address would overwrite
 * the checksummed version already on record.
 */
function toDisplay(address: Address): Address {
  try {
    return getAddress(address);
  } catch {
    return address;
  }
}

export class SubscriptionStore {
  private chats = new Map<string, Set<string>>();
  /** Preserves the checksummed form for display. */
  private display = new Map<string, Address>();
  /** Chain id per auction, when known. */
  private chainIds = new Map<string, number>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SerializedFile;
      for (const [chatId, entry] of Object.entries(parsed.chats ?? {})) {
        const set = new Set<string>();
        for (const address of entry.auctions ?? []) {
          const key = normalise(address as Address);
          set.add(key);
          this.display.set(key, toDisplay(address as Address));
        }
        this.chats.set(chatId, set);
      }
      for (const [key, chainId] of Object.entries(parsed.chains ?? {})) {
        this.chainIds.set(key.toLowerCase(), chainId);
      }
    } catch {
      // No file yet - a fresh install starts with no subscriptions.
    }
  }

  private async persist(): Promise<void> {
    const chats: SerializedFile["chats"] = {};
    for (const [chatId, set] of this.chats) {
      chats[chatId] = {
        auctions: [...set].map((key) => this.display.get(key) ?? key),
      };
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(
        { version: 1, chats, chains: Object.fromEntries(this.chainIds) } satisfies SerializedFile,
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  /** @returns false when the chat was already watching it. */
  async watch(chatId: string, auction: Address, chainId?: number): Promise<boolean> {
    await this.load();
    const key = normalise(auction);
    this.display.set(key, toDisplay(auction));
    if (chainId !== undefined && this.chainIds.get(key) !== chainId) {
      this.chainIds.set(key, chainId);
      await this.persist();
    }

    const set = this.chats.get(chatId) ?? new Set<string>();
    if (set.has(key)) return false;

    set.add(key);
    this.chats.set(chatId, set);
    await this.persist();
    return true;
  }

  /** @returns false when the chat was not watching it. */
  async unwatch(chatId: string, auction: Address): Promise<boolean> {
    await this.load();
    const set = this.chats.get(chatId);
    if (!set?.delete(normalise(auction))) return false;

    if (set.size === 0) this.chats.delete(chatId);
    await this.persist();
    return true;
  }

  async auctionsFor(chatId: string): Promise<Address[]> {
    await this.load();
    const set = this.chats.get(chatId) ?? new Set<string>();
    return [...set].map((key) => this.display.get(key) ?? (key as Address));
  }

  /** Every auction any chat is watching - what the poll loop must read. */
  async allAuctions(): Promise<Address[]> {
    await this.load();
    const union = new Set<string>();
    for (const set of this.chats.values()) for (const key of set) union.add(key);
    return [...union].map((key) => this.display.get(key) ?? (key as Address));
  }

  /** Chats that should be told about an alert on this auction. */
  async subscribersOf(auction: Address): Promise<string[]> {
    await this.load();
    const key = normalise(auction);
    const result: string[] = [];
    for (const [chatId, set] of this.chats) if (set.has(key)) result.push(chatId);
    return result;
  }

  async allChats(): Promise<ChatSubscription[]> {
    await this.load();
    return [...this.chats.entries()].map(([chatId, set]) => ({
      chatId,
      auctions: [...set].map((key) => this.display.get(key) ?? (key as Address)),
    }));
  }

  /** The chain an auction was registered on, if recorded. */
  async chainOf(auction: Address): Promise<number | undefined> {
    await this.load();
    return this.chainIds.get(normalise(auction));
  }

  /** Record a chain learned after the fact (e.g. matched from a store). */
  async setChain(auction: Address, chainId: number): Promise<void> {
    await this.load();
    const key = normalise(auction);
    if (this.chainIds.get(key) === chainId) return;
    this.chainIds.set(key, chainId);
    await this.persist();
  }

  async isEmpty(): Promise<boolean> {
    await this.load();
    return this.chats.size === 0;
  }
}
