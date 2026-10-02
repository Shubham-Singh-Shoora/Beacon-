/**
 * History backfill from Blockscout, for chains whose free RPC refuses old
 * `eth_getLogs` (Ethereum and Base Sepolia, as measured - see networks.ts).
 *
 * Blockscout's etherscan-compatible `getLogs` takes any block range with no key,
 * but caps a response at 1,000 logs and ignores `page`, so this paginates by
 * block: on a full page it re-queries from the last block it saw and
 * de-duplicates. It is rate-limited, so it backs off and retries.
 *
 * Used once per chain to build the store; recent blocks come from the RPC.
 */
import { decodeEventLog } from "viem";
import type { Address, Hex } from "viem";
import { factoryAbi } from "./abis";
import { factoriesOnChain } from "./constants";
import { auctionCreatedEvent } from "./discover";
import { networkFor } from "./networks";
import type { DiscoveredAuction } from "./types";

const AUCTION_CREATED_TOPIC = "0x7ede475fad18ccf0039f2b956c4d43a8b4ed0853de4daaa8ae25299f331ae3b9";
const PAGE_CAP = 1000;

interface BlockscoutLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

async function fetchPage(
  url: string,
  options: { fetchImpl: typeof fetch; retries: number; onRetry?: (message: string) => void },
): Promise<BlockscoutLog[]> {
  for (let attempt = 0; ; attempt++) {
    let message: string;
    try {
      const response = await options.fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
      const body = (await response.json()) as { status?: string; message?: string; result?: unknown };
      // "No records found" is a successful empty answer.
      if (Array.isArray(body.result)) return body.result as BlockscoutLog[];
      message = String(body.message ?? `HTTP ${response.status}`);
    } catch (error) {
      message = (error as Error).message;
    }
    if (attempt >= options.retries) throw new Error(`Blockscout request failed: ${message}`);
    options.onRetry?.(`${message} - retrying`);
    await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
  }
}

function toDiscovered(log: BlockscoutLog): DiscoveredAuction {
  const decoded = decodeEventLog({
    abi: factoryAbi,
    eventName: auctionCreatedEvent.name,
    data: log.data as Hex,
    topics: log.topics.filter(Boolean) as [Hex, ...Hex[]],
  });
  const args = decoded.args as { auction: Address; token: Address; amount: bigint; configData: Hex };
  return {
    auction: args.auction,
    token: args.token,
    amount: args.amount,
    configData: args.configData,
    factory: log.address as Address,
    blockNumber: BigInt(log.blockNumber),
    transactionHash: log.transactionHash as Hex,
    logIndex: Number(log.logIndex),
  };
}

/**
 * Every auction created on `chainId` from `fromBlock` to `toBlock`, across all
 * factory versions, read from Blockscout. Oldest first.
 */
export async function scanAuctionsViaBlockscout(
  chainId: number,
  range: { fromBlock?: bigint; toBlock: bigint },
  options: { fetchImpl?: typeof fetch; retries?: number; onProgress?: (message: string) => void } = {},
): Promise<DiscoveredAuction[]> {
  const network = networkFor(chainId);
  if (!network) throw new Error(`No Blockscout host known for chain ${chainId}.`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const seen = new Map<string, DiscoveredAuction>();

  for (const factory of factoriesOnChain(chainId)) {
    let from = range.fromBlock ?? factory.startBlock[chainId] ?? 0n;
    for (;;) {
      const url =
        `https://${network.blockscout}/api?module=logs&action=getLogs` +
        `&address=${factory.address}&topic0=${AUCTION_CREATED_TOPIC}` +
        `&fromBlock=${from}&toBlock=${range.toBlock}`;
      const logs = await fetchPage(url, {
        fetchImpl,
        retries: options.retries ?? 6,
        onRetry: options.onProgress,
      });
      for (const log of logs) {
        const auction = toDiscovered(log);
        seen.set(auction.auction.toLowerCase(), auction);
      }
      options.onProgress?.(`${factory.version}: ${seen.size} auctions so far (from block ${from})`);
      if (logs.length < PAGE_CAP) break;

      // Full page: continue from the last block seen. If the whole page sat in
      // one block, step past it rather than loop forever.
      const last = BigInt(logs[logs.length - 1]!.blockNumber);
      from = last > from ? last : from + 1n;
    }
  }

  return [...seen.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}
