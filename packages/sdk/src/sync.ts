/**
 * Keeping the auction store up to date.
 *
 * `syncAuctions` scans forward from the store's watermark and merges what it
 * finds. Because the store merges rather than replaces, running it repeatedly
 * against an unreliable endpoint converges on the true set: each pass can only
 * add auctions, never lose ones already recorded.
 */
import { scanAuctions } from "./discover";
import { scanAuctionsViaBlockscout } from "./explorer";
import { requireFactoryDeployBlock } from "./client";
import type { BeaconClient } from "./client";
import type { AuctionStore } from "./store";
import type { DiscoveredAuction } from "./types";

export interface SyncOptions {
  /**
   * Re-scan from the factory deploy block rather than the store's watermark.
   * Use when converging a list built on an unreliable RPC.
   */
  full?: boolean;
  /** Blocks per getLogs request. Defaults to the chain's measured limit. */
  chunkSize?: bigint;
  /** How many times to re-scan the range in one call, unioning results. */
  passes?: number;
  /**
   * Where history comes from on a full scan. `auto` (default) uses the RPC
   * when the chain's free endpoint serves old logs and Blockscout when it does
   * not; `rpc` / `blockscout` force one.
   */
  historySource?: "auto" | "rpc" | "blockscout";
  /**
   * Blocks re-scanned behind the watermark on an incremental sync, so a chunk a
   * flaky endpoint answered falsely-empty last time gets a second look.
   * Defaults to ~6 hours of blocks.
   */
  overlapBlocks?: bigint;
  onProgress?: (message: string) => void;
}

export interface SyncResult {
  added: number;
  total: number;
  scannedFrom: bigint;
  scannedTo: bigint;
  anomalies: number;
  passes: number;
  source: "rpc" | "blockscout";
}

export async function syncAuctions(
  client: BeaconClient,
  store: AuctionStore,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const head = await client.publicClient.getBlockNumber();
  const existing = await store.read();
  const passes = Math.max(1, options.passes ?? 1);
  const deployBlock = requireFactoryDeployBlock(client);

  // A factory the store has never scanned (e.g. a new CCA version) has no
  // watermark, so resuming would silently skip its history.
  const covered = new Set(existing?.factoryAddresses.map((a) => a.toLowerCase()) ?? []);
  const missingFactory = client.factoryAddresses.some((a) => !covered.has(a.toLowerCase()));
  const fullScan = options.full || !existing || missingFactory;

  const overlap = options.overlapBlocks ?? BigInt((client.network?.blocksPerHour ?? 300) * 6);
  const from = fullScan
    ? deployBlock
    : existing.lastSyncedBlock > deployBlock + overlap
      ? existing.lastSyncedBlock - overlap
      : deployBlock;

  if (from > head) {
    return {
      added: 0,
      total: existing?.auctions.length ?? 0,
      scannedFrom: from,
      scannedTo: head,
      anomalies: 0,
      passes: 0,
      source: "rpc",
    };
  }

  const historySource = options.historySource ?? "auto";
  // On a full scan, Blockscout is also the better source when the RPC would need
  // hundreds of small requests (Base: 2,000-block cap over 10M+ blocks).
  const rpcRequests = (head - from) / (options.chunkSize ?? client.logChunkSize) + 1n;
  const useBlockscout =
    historySource === "blockscout" ||
    (historySource === "auto" &&
      fullScan &&
      client.network !== undefined &&
      (client.network.historicalLogs === false || rpcRequests > 500n));

  let anomalies = 0;
  let source: "rpc" | "blockscout" = useBlockscout ? "blockscout" : "rpc";
  const union = new Map<string, DiscoveredAuction>();
  const addAll = (found: DiscoveredAuction[]) => {
    let fresh = 0;
    for (const auction of found) {
      const key = auction.auction.toLowerCase();
      if (!union.has(key)) fresh++;
      union.set(key, auction);
    }
    return fresh;
  };

  if (useBlockscout) {
    options.onProgress?.(`backfilling ${from} -> ${head} from Blockscout`);
    const found = await scanAuctionsViaBlockscout(client.chainId, { fromBlock: from, toBlock: head }, {
      onProgress: options.onProgress,
    });
    addAll(found);
  } else {
    for (let pass = 1; pass <= passes; pass++) {
      options.onProgress?.(`pass ${pass}/${passes}: scanning ${from} -> ${head}`);
      let found: DiscoveredAuction[];
      try {
        found = await scanAuctions(client, {
          fromBlock: from,
          toBlock: head,
          chunkSize: options.chunkSize,
          onAnomaly: () => {
            anomalies++;
          },
        });
      } catch (error) {
        // A free endpoint refusing old blocks (e.g. the sync was paused for
        // days and the gap is no longer "recent") - fill it from Blockscout.
        if (historySource === "rpc" || !client.network) throw error;
        options.onProgress?.(
          `RPC refused ${from} -> ${head} (${(error as Error).message.split("\n")[0]}); using Blockscout`,
        );
        found = await scanAuctionsViaBlockscout(client.chainId, { fromBlock: from, toBlock: head }, {
          onProgress: options.onProgress,
        });
        source = "blockscout";
        addAll(found);
        break;
      }
      const fresh = addAll(found);
      options.onProgress?.(`pass ${pass}/${passes}: ${found.length} found, ${fresh} new (union ${union.size})`);
    }
  }

  const { added, total } = await store.merge({
    chainId: client.chainId,
    factoryAddress: client.factoryAddress,
    factoryAddresses: client.factoryAddresses,
    lastSyncedBlock: head,
    auctions: [...union.values()],
  });

  return { added, total, scannedFrom: from, scannedTo: head, anomalies, passes, source };
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
