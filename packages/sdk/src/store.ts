/**
 * A durable record of discovered auctions, plus their immutable configuration.
 *
 * Why this exists: discovery and state reads have incompatible RPC needs.
 *
 * - `eth_getLogs` over 1.5M blocks needs a provider that allows wide ranges.
 *   Alchemy's free tier caps `eth_getLogs` at a TEN block range, which would be
 *   ~153,000 requests for a full backfill.
 * - Public wide-range endpoints allow the range but are unreliable: an
 *   identical query on ethereum-sepolia-rpc.publicnode.com returns the real
 *   logs about half the time and an empty array the rest, silently. Four scans
 *   of the same range returned 52, 60, 44 and 55 auctions.
 *
 * So the auction list is built up over repeated scans and persisted. The
 * directory then reads a complete list instantly instead of re-scanning the
 * chain (and re-rolling that dice) on every page load.
 *
 * The store also caches each auction's IMMUTABLE data - start/end block, token,
 * currency, supply, floor price, and the token/currency symbol and decimals.
 * None of that can change, and caching it means the directory can render status
 * badges and currency labels for every auction with zero RPC calls. Only live
 * state (clearing price, amount raised, graduated) is read from chain.
 *
 * Storage is a JSON file. For the ~130 auctions that exist this is simpler than
 * SQLite and needs no native module, which matters on Windows where pnpm blocks
 * build scripts by default. `AuctionStore` is an interface so a SQLite or
 * Postgres implementation can replace it without touching callers.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Address } from "viem";
import type { TokenMetadata } from "./erc20";
import type { AuctionInfo, DiscoveredAuction } from "./types";

/** A discovered auction plus whatever immutable detail has been cached for it. */
export interface AuctionRecord extends DiscoveredAuction {
  info?: AuctionInfo;
  tokenMeta?: TokenMetadata;
  currencyMeta?: TokenMetadata;
}

export interface AuctionStoreSnapshot {
  chainId: number;
  factoryAddress: Address;
  /** Highest block that has been scanned. Discovery resumes from here. */
  lastSyncedBlock: bigint;
  auctions: AuctionRecord[];
}

export interface StoreUpdate {
  chainId: number;
  factoryAddress: Address;
  lastSyncedBlock: bigint;
  auctions: readonly AuctionRecord[];
}

export interface AuctionStore {
  read(): Promise<AuctionStoreSnapshot | undefined>;
  /** Merge new auctions in and advance the sync watermark. */
  merge(update: StoreUpdate): Promise<{ added: number; total: number }>;
}

// --- serialization ---------------------------------------------------------
// bigints are not JSON, so every numeric field crosses as a decimal string.

type Serialized = Record<string, unknown>;

function serializeInfo(info: AuctionInfo): Serialized {
  return {
    auction: info.auction,
    token: info.token,
    currency: info.currency,
    totalSupply: info.totalSupply.toString(),
    startBlock: info.startBlock.toString(),
    endBlock: info.endBlock.toString(),
    floorPriceQ96: info.floorPriceQ96.toString(),
    tickSpacing: info.tickSpacing.toString(),
  };
}

function deserializeInfo(raw: Serialized): AuctionInfo {
  return {
    auction: raw.auction as Address,
    token: raw.token as Address,
    currency: raw.currency as Address,
    totalSupply: BigInt(raw.totalSupply as string),
    startBlock: BigInt(raw.startBlock as string),
    endBlock: BigInt(raw.endBlock as string),
    floorPriceQ96: BigInt(raw.floorPriceQ96 as string),
    tickSpacing: BigInt(raw.tickSpacing as string),
  };
}

function serializeRecord(record: AuctionRecord): Serialized {
  return {
    auction: record.auction,
    token: record.token,
    amount: record.amount.toString(),
    configData: record.configData,
    blockNumber: record.blockNumber.toString(),
    transactionHash: record.transactionHash,
    logIndex: record.logIndex,
    ...(record.info ? { info: serializeInfo(record.info) } : {}),
    ...(record.tokenMeta ? { tokenMeta: record.tokenMeta } : {}),
    ...(record.currencyMeta ? { currencyMeta: record.currencyMeta } : {}),
  };
}

function deserializeRecord(raw: Serialized): AuctionRecord {
  return {
    auction: raw.auction as Address,
    token: raw.token as Address,
    amount: BigInt(raw.amount as string),
    configData: raw.configData as `0x${string}`,
    blockNumber: BigInt(raw.blockNumber as string),
    transactionHash: raw.transactionHash as `0x${string}`,
    logIndex: raw.logIndex as number,
    info: raw.info ? deserializeInfo(raw.info as Serialized) : undefined,
    tokenMeta: raw.tokenMeta as TokenMetadata | undefined,
    currencyMeta: raw.currencyMeta as TokenMetadata | undefined,
  };
}

function sortRecords(records: AuctionRecord[]): AuctionRecord[] {
  return records.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}

/**
 * Merge incoming records over existing ones without losing cached detail.
 * A plain discovery re-scan carries no `info`, and must not wipe it.
 */
function mergeRecords(
  existing: readonly AuctionRecord[],
  incoming: readonly AuctionRecord[],
): { merged: AuctionRecord[]; added: number } {
  const byAddress = new Map<string, AuctionRecord>();
  for (const record of existing) byAddress.set(record.auction.toLowerCase(), record);

  let added = 0;
  for (const record of incoming) {
    const key = record.auction.toLowerCase();
    const previous = byAddress.get(key);
    if (!previous) added++;
    byAddress.set(key, {
      ...previous,
      ...record,
      info: record.info ?? previous?.info,
      tokenMeta: record.tokenMeta ?? previous?.tokenMeta,
      currencyMeta: record.currencyMeta ?? previous?.currencyMeta,
    });
  }

  return { merged: sortRecords([...byAddress.values()]), added };
}

/** JSON-file backed store. */
export class JsonAuctionStore implements AuctionStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<AuctionStoreSnapshot | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return undefined;
    }

    const parsed = JSON.parse(raw) as {
      chainId: number;
      factoryAddress: Address;
      lastSyncedBlock: string;
      auctions: Serialized[];
    };

    return {
      chainId: parsed.chainId,
      factoryAddress: parsed.factoryAddress,
      lastSyncedBlock: BigInt(parsed.lastSyncedBlock),
      auctions: sortRecords(parsed.auctions.map(deserializeRecord)),
    };
  }

  async merge(update: StoreUpdate): Promise<{ added: number; total: number }> {
    const existing = await this.read();

    // A store built against a different chain or factory is not ours to merge.
    if (
      existing &&
      (existing.chainId !== update.chainId ||
        existing.factoryAddress.toLowerCase() !== update.factoryAddress.toLowerCase())
    ) {
      throw new Error(
        `Auction store at ${this.filePath} holds chain ${existing.chainId}/${existing.factoryAddress}, ` +
          `refusing to merge chain ${update.chainId}/${update.factoryAddress}.`,
      );
    }

    const { merged, added } = mergeRecords(existing?.auctions ?? [], update.auctions);

    // Never move the watermark backwards - a partial re-scan must not cause a
    // later sync to skip blocks it has not actually covered.
    const watermark =
      existing && existing.lastSyncedBlock > update.lastSyncedBlock
        ? existing.lastSyncedBlock
        : update.lastSyncedBlock;

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify(
        {
          chainId: update.chainId,
          factoryAddress: update.factoryAddress,
          lastSyncedBlock: watermark.toString(),
          auctions: merged.map(serializeRecord),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    return { added, total: merged.length };
  }
}

/** In-memory store, for tests. */
export class MemoryAuctionStore implements AuctionStore {
  private snapshot: AuctionStoreSnapshot | undefined;

  async read(): Promise<AuctionStoreSnapshot | undefined> {
    return this.snapshot;
  }

  async merge(update: StoreUpdate): Promise<{ added: number; total: number }> {
    const { merged, added } = mergeRecords(this.snapshot?.auctions ?? [], update.auctions);
    const watermark =
      this.snapshot && this.snapshot.lastSyncedBlock > update.lastSyncedBlock
        ? this.snapshot.lastSyncedBlock
        : update.lastSyncedBlock;

    this.snapshot = {
      chainId: update.chainId,
      factoryAddress: update.factoryAddress,
      lastSyncedBlock: watermark,
      auctions: merged,
    };
    return { added, total: merged.length };
  }
}
