/**
 * Read wrappers around `AuctionStateLens` and the auction's own view functions.
 *
 * Two things here are non-obvious, and are the reason this lives in the SDK
 * rather than being reimplemented per app:
 *
 * 1. `AuctionStateLens.state()` is NOT a view function. It calls the
 *    state-mutating `auction.checkpoint()` and returns its result by reverting
 *    with ABI-encoded data. It therefore has to be invoked with `eth_call`
 *    semantics; a plain `readContract` fails.
 *
 * 2. Uniswap publishes no canonical lens address on any network. Rather than
 *    forcing every user to deploy one, Beacon can inject the lens bytecode into
 *    a single `eth_call` via a state override, so reads work against a bare RPC
 *    with no deployment and no funded wallet. Set `lensAddress` on the client
 *    to use a real deployed lens instead.
 */
import { decodeFunctionResult, encodeFunctionData } from "viem";
import type { Address } from "viem";
import { auctionAbi, auctionStateLensAbi, auctionStateLensDeployedBytecode } from "./abis";
import type { BeaconClient } from "./client";
import { formatQ96, mpsToFraction } from "./q96";
import type { AuctionInfo, AuctionState, AuctionStatus, AuctionSummary, Checkpoint } from "./types";

/**
 * Address the lens bytecode is injected at when no deployed lens is configured.
 * Arbitrary and unused on-chain: it only has to be an address nothing else
 * occupies for the duration of the call. Must be EIP-55 checksummed - viem
 * rejects a mixed-case address whose checksum does not validate.
 */
export const LENS_OVERRIDE_ADDRESS: Address = "0x00000000000000000000000000000000BEAC0E75";

/** Shape `decodeFunctionResult` produces for the lens's `AuctionState` tuple. */
type RawAuctionState = {
  checkpoint: {
    clearingPrice: bigint;
    currencyRaisedAtClearingPriceQ96_X7: bigint;
    cumulativeMpsPerPrice: bigint;
    cumulativeMps: number;
    prev: bigint;
    next: bigint;
  };
  currencyRaised: bigint;
  totalCleared: bigint;
  isGraduated: boolean;
};

function toCheckpoint(raw: RawAuctionState["checkpoint"]): Checkpoint {
  return {
    clearingPriceQ96: raw.clearingPrice,
    currencyRaisedAtClearingPriceQ96X7: raw.currencyRaisedAtClearingPriceQ96_X7,
    cumulativeMpsPerPrice: raw.cumulativeMpsPerPrice,
    cumulativeMps: Number(raw.cumulativeMps),
    prevBlock: BigInt(raw.prev),
    nextBlock: BigInt(raw.next),
  };
}

/**
 * Read an auction's live state through `AuctionStateLens.state()`.
 *
 * This is the freshest possible view: the lens checkpoints the auction inside
 * the simulated call, so the clearing price reflects the current block rather
 * than the last block someone happened to bid in.
 */
export async function getAuctionState(client: BeaconClient, auction: Address): Promise<AuctionState> {
  const data = encodeFunctionData({
    abi: auctionStateLensAbi,
    functionName: "state",
    args: [auction],
  });

  const useOverride = client.lensAddress === undefined;
  const target = client.lensAddress ?? LENS_OVERRIDE_ADDRESS;

  const { data: returnData } = await client.publicClient.call({
    to: target,
    data,
    ...(useOverride
      ? {
          stateOverride: [
            { address: LENS_OVERRIDE_ADDRESS, code: auctionStateLensDeployedBytecode },
          ],
        }
      : {}),
  });

  if (!returnData) {
    throw new Error(
      `AuctionStateLens.state(${auction}) returned no data. ` +
        `Is ${auction} really a ContinuousClearingAuction on ${client.chain.name}?`,
    );
  }

  const raw = decodeFunctionResult({
    abi: auctionStateLensAbi,
    functionName: "state",
    data: returnData,
  }) as unknown as RawAuctionState;

  return {
    checkpoint: toCheckpoint(raw.checkpoint),
    currencyRaised: raw.currencyRaised,
    totalCleared: raw.totalCleared,
    isGraduated: raw.isGraduated,
  };
}

/**
 * Read an auction's static configuration in a single multicall.
 * These values never change, so callers can cache them freely.
 */
export async function getAuctionInfo(client: BeaconClient, auction: Address): Promise<AuctionInfo> {
  const contract = { address: auction, abi: auctionAbi } as const;

  const [token, currency, totalSupply, startBlock, endBlock, floorPrice, tickSpacing] =
    await client.publicClient.multicall({
      allowFailure: false,
      contracts: [
        { ...contract, functionName: "token" },
        { ...contract, functionName: "currency" },
        { ...contract, functionName: "totalSupply" },
        { ...contract, functionName: "startBlock" },
        { ...contract, functionName: "endBlock" },
        { ...contract, functionName: "floorPrice" },
        { ...contract, functionName: "tickSpacing" },
      ],
    });

  return {
    auction,
    token,
    currency,
    totalSupply,
    startBlock: BigInt(startBlock),
    endBlock: BigInt(endBlock),
    floorPriceQ96: floorPrice,
    tickSpacing,
  };
}

/** The auction's current clearing price, Q96-encoded. A cheap `view` read. */
export async function getClearingPrice(client: BeaconClient, auction: Address): Promise<bigint> {
  return client.publicClient.readContract({
    address: auction,
    abi: auctionAbi,
    functionName: "clearingPrice",
  });
}

/** Whether the auction has raised enough to seed the pool. */
export async function isGraduated(client: BeaconClient, auction: Address): Promise<boolean> {
  return client.publicClient.readContract({
    address: auction,
    abi: auctionAbi,
    functionName: "isGraduated",
  });
}

/** Derive an auction's lifecycle position from the current block. */
export function deriveStatus(info: AuctionInfo, blockNumber: bigint): AuctionStatus {
  if (blockNumber < info.startBlock) return "pending";
  if (blockNumber <= info.endBlock) return "live";
  return "ended";
}

/**
 * Everything a UI needs about one auction, with the derived values (status,
 * progress, time remaining) computed once here instead of in each app.
 */
export async function getAuctionSummary(
  client: BeaconClient,
  auction: Address,
  options: { info?: AuctionInfo; blockNumber?: bigint } = {},
): Promise<AuctionSummary> {
  const [info, state, blockNumber] = await Promise.all([
    options.info ?? getAuctionInfo(client, auction),
    getAuctionState(client, auction),
    options.blockNumber ?? client.publicClient.getBlockNumber(),
  ]);

  const status = deriveStatus(info, blockNumber);
  const blocksRemaining =
    status === "pending"
      ? info.startBlock - blockNumber
      : status === "live"
        ? info.endBlock - blockNumber
        : 0n;

  return {
    info,
    state,
    blockNumber,
    status,
    clearingPrice: formatQ96(state.checkpoint.clearingPriceQ96),
    supplyScheduleProgress: mpsToFraction(state.checkpoint.cumulativeMps),
    hasClearedSupply: state.totalCleared > 0n,
    blocksRemaining,
    secondsRemaining: Number(blocksRemaining) * client.blockTimeSeconds,
  };
}

/** A summary that failed to load, so one bad auction cannot blank a directory page. */
export interface FailedAuctionSummary {
  auction: Address;
  error: Error;
}

export function isFailedSummary(
  result: AuctionSummary | FailedAuctionSummary,
): result is FailedAuctionSummary {
  return "error" in result;
}

/**
 * Summarise many auctions with bounded concurrency, so a directory page listing
 * dozens of auctions does not open dozens of simultaneous RPC calls.
 */
export async function getAuctionSummaries(
  client: BeaconClient,
  auctions: readonly Address[],
  options: { concurrency?: number } = {},
): Promise<(AuctionSummary | FailedAuctionSummary)[]> {
  const concurrency = options.concurrency ?? 5;
  const blockNumber = await client.publicClient.getBlockNumber();
  const results: (AuctionSummary | FailedAuctionSummary)[] = [];

  for (let i = 0; i < auctions.length; i += concurrency) {
    const batch = auctions.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (auction) => {
        try {
          return await getAuctionSummary(client, auction, { blockNumber });
        } catch (error) {
          return { auction, error: error as Error };
        }
      }),
    );
    results.push(...settled);
  }

  return results;
}
