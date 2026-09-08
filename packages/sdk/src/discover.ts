/**
 * Auction discovery: finding every CCA auction ever deployed by scanning the
 * factory's `AuctionCreated` event.
 *
 * `eth_getLogs` MUST be chunked. Public Sepolia RPCs reject spans wider than
 * 50,000 blocks with `-32701: exceed maximum block range`, and some clients
 * report that as an empty result rather than an error, which looks exactly like
 * "this factory has never created an auction". Everything here chunks, and
 * halves the chunk size on failure rather than silently returning a short list.
 */
import { getAbiItem } from "viem";
import type { Address, Log } from "viem";
import { factoryAbi } from "./abis";
import type { BeaconClient } from "./client";
import { DEFAULT_LOG_CHUNK_SIZE } from "./constants";
import type { DiscoveredAuction } from "./types";

/** The factory event that announces every new auction. */
export const auctionCreatedEvent = getAbiItem({ abi: factoryAbi, name: "AuctionCreated" });

export interface ScanOptions {
  /** First block to scan. Defaults to the factory's deploy block. */
  fromBlock?: bigint;
  /** Last block to scan. Defaults to the current head. */
  toBlock?: bigint;
  /** Blocks per `eth_getLogs` request. Defaults to 50,000. */
  chunkSize?: bigint;
  /**
   * Re-query a chunk that came back empty, this many times, before believing it.
   *
   * Some public RPCs (observed on ethereum-sepolia-rpc.publicnode.com) are load
   * balanced across backends with incomplete log indexes and answer an
   * identical `eth_getLogs` with either the real logs or an empty array, with no
   * error. That silently under-reports auctions. Re-querying an empty chunk
   * reduces the chance of believing a false empty, but CANNOT eliminate it -
   * the real fix is a reliable RPC endpoint. Defaults to 2.
   */
  emptyChunkRetries?: number;
  /**
   * Called when an empty chunk turned out to be a lie on retry. A caller seeing
   * these should switch RPC providers rather than trust the scan.
   */
  onAnomaly?: (anomaly: { fromBlock: bigint; toBlock: bigint; recoveredLogs: number }) => void;
  /** Called after each chunk, for progress reporting on long scans. */
  onProgress?: (progress: {
    fromBlock: bigint;
    toBlock: bigint;
    scannedTo: bigint;
    headBlock: bigint;
    found: number;
  }) => void;
}

type AuctionCreatedLog = Log<bigint, number, false, typeof auctionCreatedEvent>;

function toDiscoveredAuction(log: AuctionCreatedLog): DiscoveredAuction {
  const { auction, token, amount, configData } = log.args;

  // Indexed address args are always present on a well-formed log, but viem
  // types them optional because a filter could omit them.
  if (!auction || !token) {
    throw new Error(`Malformed AuctionCreated log in block ${log.blockNumber}: missing auction/token`);
  }

  return {
    auction,
    token,
    amount: amount ?? 0n,
    configData: configData ?? "0x",
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
  };
}

/**
 * Scan a block range for `AuctionCreated` events, chunked.
 *
 * Returns auctions in chain order (oldest first). On a chunk failure the chunk
 * size is halved and retried, so a stricter-than-expected RPC degrades into a
 * slower scan rather than a wrong answer.
 */
export async function scanAuctions(
  client: BeaconClient,
  options: ScanOptions = {},
): Promise<DiscoveredAuction[]> {
  const headBlock = options.toBlock ?? (await client.publicClient.getBlockNumber());
  const startBlock = options.fromBlock ?? client.factoryDeployBlock;
  const maxChunk = options.chunkSize ?? DEFAULT_LOG_CHUNK_SIZE;

  if (startBlock > headBlock) return [];

  const emptyChunkRetries = options.emptyChunkRetries ?? 2;
  const found: DiscoveredAuction[] = [];
  let cursor = startBlock;
  let chunkSize = maxChunk;

  while (cursor <= headBlock) {
    const chunkEnd = min(cursor + chunkSize - 1n, headBlock);

    // Log scanning may use a different provider than state reads.
    const fetchChunk = async (from: bigint, to: bigint): Promise<AuctionCreatedLog[]> =>
      (await client.logsClient.getLogs({
        address: client.factoryAddress,
        event: auctionCreatedEvent,
        fromBlock: from,
        toBlock: to,
      })) as AuctionCreatedLog[];

    let logs: AuctionCreatedLog[];
    try {
      logs = await fetchChunk(cursor, chunkEnd);

      // An empty result from an unreliable endpoint may be a lie. Re-ask.
      for (let attempt = 0; logs.length === 0 && attempt < emptyChunkRetries; attempt++) {
        const retry = await fetchChunk(cursor, chunkEnd);
        if (retry.length > 0) {
          options.onAnomaly?.({
            fromBlock: cursor,
            toBlock: chunkEnd,
            recoveredLogs: retry.length,
          });
          logs = retry;
        }
      }
    } catch (error) {
      // Most likely a provider-specific range or response-size cap. Back off and
      // retry rather than losing auctions.
      if (chunkSize > 1n) {
        chunkSize = chunkSize / 2n;
        continue;
      }
      throw new Error(
        `eth_getLogs failed for a single block (${cursor}) on ${client.chain.name}: ${
          (error as Error).message
        }`,
      );
    }

    for (const log of logs) found.push(toDiscoveredAuction(log));

    options.onProgress?.({
      fromBlock: cursor,
      toBlock: chunkEnd,
      scannedTo: chunkEnd,
      headBlock,
      found: found.length,
    });

    cursor = chunkEnd + 1n;
    // Recover toward the configured chunk size after a successful request.
    if (chunkSize < maxChunk) chunkSize = min(chunkSize * 2n, maxChunk);
  }

  found.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );

  return found;
}

/**
 * Watch for auctions created from now on.
 *
 * Polls rather than subscribing, so it works over plain HTTP RPC with no
 * WebSocket endpoint. Returns an unwatch function.
 */
export function watchAuctions(
  client: BeaconClient,
  onAuction: (auction: DiscoveredAuction) => void,
  options: { pollingIntervalMs?: number; onError?: (error: Error) => void } = {},
): () => void {
  return client.logsClient.watchEvent({
    address: client.factoryAddress,
    event: auctionCreatedEvent,
    poll: true,
    pollingInterval: options.pollingIntervalMs ?? 12_000,
    onError: options.onError,
    onLogs: (logs) => {
      for (const log of logs as AuctionCreatedLog[]) {
        try {
          onAuction(toDiscoveredAuction(log));
        } catch (error) {
          options.onError?.(error as Error);
        }
      }
    },
  });
}

/**
 * Auctions created for a specific token.
 * Uses an indexed-topic filter so the RPC does the work, not the client.
 */
export async function scanAuctionsForToken(
  client: BeaconClient,
  token: Address,
  options: ScanOptions = {},
): Promise<DiscoveredAuction[]> {
  const all = await scanAuctions(client, options);
  return all.filter((entry) => entry.token.toLowerCase() === token.toLowerCase());
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
