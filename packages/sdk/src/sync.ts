/**
 * Keeping the auction store up to date.
 *
 * `syncAuctions` scans forward from the store's watermark and merges what it
 * finds. Because the store merges rather than replaces, running it repeatedly
 * against an unreliable endpoint converges on the true set: each pass can only
 * add auctions, never lose ones already recorded.
 */
import { scanAuctions } from "./discover";
import type { BeaconClient } from "./client";
import type { AuctionStore } from "./store";
import type { DiscoveredAuction } from "./types";

export interface SyncOptions {
  /**
   * Re-scan from the factory deploy block rather than the store's watermark.
   * Use when converging a list built on an unreliable RPC.
   */
  full?: boolean;
  /** Blocks per getLogs request. */
  chunkSize?: bigint;
  /** How many times to re-scan the range in one call, unioning results. */
  passes?: number;
  onProgress?: (message: string) => void;
}

export interface SyncResult {
  added: number;
  total: number;
  scannedFrom: bigint;
  scannedTo: bigint;
  anomalies: number;
  passes: number;
}

export async function syncAuctions(
  client: BeaconClient,
  store: AuctionStore,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const head = await client.publicClient.getBlockNumber();
  const existing = await store.read();
  const passes = Math.max(1, options.passes ?? 1);

  const from =
    options.full || !existing
      ? client.factoryDeployBlock
      : // Re-scan the last block already covered, in case it was mid-block.
        existing.lastSyncedBlock;

  if (from > head) {
    return {
      added: 0,
      total: existing?.auctions.length ?? 0,
      scannedFrom: from,
      scannedTo: head,
      anomalies: 0,
      passes: 0,
    };
  }

  let anomalies = 0;
  const union = new Map<string, DiscoveredAuction>();

  for (let pass = 1; pass <= passes; pass++) {
    options.onProgress?.(`pass ${pass}/${passes}: scanning ${from} -> ${head}`);

    const found = await scanAuctions(client, {
      fromBlock: from,
      toBlock: head,
      chunkSize: options.chunkSize,
      onAnomaly: () => {
        anomalies++;
      },
    });

    let newThisPass = 0;
    for (const auction of found) {
      const key = auction.auction.toLowerCase();
      if (!union.has(key)) newThisPass++;
      union.set(key, auction);
    }

    options.onProgress?.(
      `pass ${pass}/${passes}: ${found.length} found, ${newThisPass} new (union ${union.size})`,
    );
  }

  const { added, total } = await store.merge({
    chainId: client.chainId,
    factoryAddress: client.factoryAddress,
    lastSyncedBlock: head,
    auctions: [...union.values()],
  });

  return { added, total, scannedFrom: from, scannedTo: head, anomalies, passes };
}

/**
 * Read the auction list, preferring the store and falling back to a live scan.
 *
 * This is what the directory uses. A cached list is correct because auctions are
 * append-only; only very recently created auctions could be missing, which the
 * next sync picks up.
 */
export async function loadAuctions(
  client: BeaconClient,
  store: AuctionStore | undefined,
  options: { fallbackToScan?: boolean } = {},
): Promise<{ auctions: DiscoveredAuction[]; source: "store" | "scan" | "empty" }> {
  if (store) {
    const snapshot = await store.read();
    if (snapshot && snapshot.auctions.length > 0) {
      return { auctions: snapshot.auctions, source: "store" };
    }
  }

  if (options.fallbackToScan) {
    const auctions = await scanAuctions(client);
    return { auctions, source: "scan" };
  }

  return { auctions: [], source: "empty" };
}
