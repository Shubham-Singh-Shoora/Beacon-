/**
 * Settling bids after (or during) an auction: exiting and claiming.
 *
 * A CCA never pushes anything to bidders. Refunds and tokens sit in the auction
 * until someone calls `exitBid` / `exitPartiallyFilledBid` and then
 * `claimTokens`. Anyone may call all three for ANY bid - the contract always
 * pays `bid.owner` - so settling needs a wallet for gas, not the bidder's key.
 *
 * The hard part is `exitPartiallyFilledBid`, which takes two checkpoint blocks
 * as hints. Checkpoints form a linked list (`prev` / `next`, ending at
 * `type(uint64).max`) and clearing prices never decrease along it. For a bid
 * with max price P the contract requires (ContinuousClearingAuction.sol,
 * identical in v1.1.0 and v2.1.0):
 *
 *   lastFullyFilled  price < P, its `next` has price >= P, and >= bid.startBlock
 *   outbid           price > P and its `prev` has price <= P
 *                    - or 0, when the auction is over and ended exactly at P
 *
 * Everything here is planning and encoding. Nothing signs or sends; every
 * planned transaction should be simulated before it is broadcast.
 */
import { encodeFunctionData } from "viem";
import type { Address, Hex } from "viem";
import { auctionAbi } from "./abis";
import type { BeaconClient } from "./client";

/** End-of-list sentinel for `Checkpoint.next`. */
export const MAX_BLOCK_NUMBER = 2n ** 64n - 1n;

export interface BidData {
  id: bigint;
  owner: Address;
  startBlock: bigint;
  /** Non-zero once the bid has been exited. */
  exitedBlock: bigint;
  maxPriceQ96: bigint;
  amountQ96: bigint;
  /** Tokens owed to the owner. Set on exit, zeroed when claimed. */
  tokensFilled: bigint;
}

export interface CheckpointLink {
  block: bigint;
  clearingPriceQ96: bigint;
  prev: bigint;
  next: bigint;
}

export interface ExitHints {
  lastFullyFilledCheckpointBlock: bigint;
  /** 0 means "ended exactly at the bid's max price". */
  outbidBlock: bigint;
}

/** Where the auction is, as far as settling is concerned. */
export interface AuctionSettleState {
  headBlock: bigint;
  endBlock: bigint;
  claimBlock: bigint;
  graduated: boolean;
  /** Clearing price including the current block (the lens runs `checkpoint()`). */
  clearingPriceQ96: bigint;
}

export type BidAction =
  | { kind: "exit"; reason: string }
  | { kind: "exitPartial"; reason: string; hints: ExitHints }
  | { kind: "claim"; reason: string }
  | { kind: "wait"; reason: string }
  | { kind: "done"; reason: string };

/**
 * Compute `exitPartiallyFilledBid` hints from the checkpoint chain.
 *
 * `chain` must be in list order and start at or before the bid's start
 * checkpoint. Returns `undefined` with a reason when no valid pair exists yet -
 * e.g. the price only moved above the bid in a block nobody has checkpointed.
 */
export function computeExitHints(
  chain: readonly CheckpointLink[],
  bid: Pick<BidData, "startBlock" | "maxPriceQ96">,
  state: Pick<AuctionSettleState, "headBlock" | "endBlock" | "clearingPriceQ96">,
): { hints: ExitHints } | { hints?: undefined; reason: string } {
  const P = bid.maxPriceQ96;
  const fromStart = chain.filter((c) => c.block >= bid.startBlock);
  if (fromStart.length === 0 || fromStart[0]!.block !== bid.startBlock) {
    return { reason: `no checkpoint at the bid's start block ${bid.startBlock}` };
  }

  // Last checkpoint strictly below P. A bid can only be placed above the
  // clearing price, so the start checkpoint always qualifies.
  let last: CheckpointLink | undefined;
  for (const c of fromStart) {
    if (c.clearingPriceQ96 < P) last = c;
    else break;
  }
  if (!last) return { reason: "the clearing price was already at the bid's max price when it was placed" };

  const outbid = fromStart.find((c) => c.clearingPriceQ96 > P);
  const over = state.headBlock >= state.endBlock;

  if (outbid) {
    // prev of the outbid checkpoint must be <= P - true by monotonicity, as
    // `outbid` is the first checkpoint above P.
    return { hints: { lastFullyFilledCheckpointBlock: last.block, outbidBlock: outbid.block } };
  }

  if (over) {
    if (state.clearingPriceQ96 === P) {
      return { hints: { lastFullyFilledCheckpointBlock: last.block, outbidBlock: 0n } };
    }
    if (state.clearingPriceQ96 > P) {
      // The price crossed P only in the final, not-yet-stored checkpoint. The
      // exit call runs checkpoint() first, which writes it at the end block.
      return { hints: { lastFullyFilledCheckpointBlock: last.block, outbidBlock: state.endBlock } };
    }
  }
  return { reason: "the bid has not been outbid in any stored checkpoint yet" };
}

/**
 * Decide what one bid needs. Pure - the caller supplies the checkpoint chain
 * (only consulted for partial exits) and the auction state.
 */
export function decideBidAction(
  bid: BidData,
  state: AuctionSettleState,
  chain: readonly CheckpointLink[],
): BidAction {
  const over = state.headBlock >= state.endBlock;
  const claimable = state.headBlock >= state.claimBlock;

  if (bid.exitedBlock !== 0n) {
    if (bid.tokensFilled === 0n) return { kind: "done", reason: "exited; nothing left to claim" };
    return claimable
      ? { kind: "claim", reason: "exited; tokens ready to claim" }
      : { kind: "wait", reason: `exited; tokens claimable from block ${state.claimBlock}` };
  }

  if (!state.graduated) {
    return over
      ? { kind: "exit", reason: "auction did not graduate - full refund" }
      : { kind: "wait", reason: "auction has not graduated; bids cannot exit until it does or it ends" };
  }

  if (over && bid.maxPriceQ96 > state.clearingPriceQ96) {
    return { kind: "exit", reason: "won - max price above the final clearing price" };
  }

  if (!over && bid.maxPriceQ96 >= state.clearingPriceQ96) {
    return { kind: "wait", reason: "still active - not outbid" };
  }

  const result = computeExitHints(chain, bid, state);
  if (!result.hints) return { kind: "wait", reason: result.reason };
  return {
    kind: "exitPartial",
    reason: over ? "partially filled or outbid - refund the rest" : "outbid - exit early for a refund",
    hints: result.hints,
  };
}

// --- chain reads -------------------------------------------------------------

export async function getBid(client: BeaconClient, auction: Address, id: bigint): Promise<BidData> {
  const raw = await client.publicClient.readContract({
    address: auction,
    abi: auctionAbi,
    functionName: "bids",
    args: [id],
  });
  return toBidData(id, raw);
}

function toBidData(
  id: bigint,
  raw: {
    owner: Address;
    startBlock: bigint | number;
    exitedBlock: bigint | number;
    maxPrice: bigint;
    amountQ96: bigint;
    tokensFilled: bigint;
  },
): BidData {
  return {
    id,
    owner: raw.owner,
    startBlock: BigInt(raw.startBlock),
    exitedBlock: BigInt(raw.exitedBlock),
    maxPriceQ96: raw.maxPrice,
    amountQ96: raw.amountQ96,
    tokensFilled: raw.tokensFilled,
  };
}

/**
 * Walk the checkpoint list forward from `fromBlock` (which must be a
 * checkpoint, e.g. a bid's start block) to the newest stored checkpoint.
 * Sequential by nature - each step needs the previous `next`.
 */
export async function readCheckpointChain(
  client: BeaconClient,
  auction: Address,
  fromBlock: bigint,
  options: { maxSteps?: number; onProgress?: (steps: number) => void } = {},
): Promise<CheckpointLink[]> {
  const maxSteps = options.maxSteps ?? 50_000;
  const chain: CheckpointLink[] = [];
  let block = fromBlock;
  while (block !== 0n && block !== MAX_BLOCK_NUMBER) {
    if (chain.length >= maxSteps) {
      throw new Error(`Checkpoint chain longer than ${maxSteps} steps from block ${fromBlock}; aborting.`);
    }
    const c = await client.publicClient.readContract({
      address: auction,
      abi: auctionAbi,
      functionName: "checkpoints",
      args: [block],
    });
    const link = { block, clearingPriceQ96: c.clearingPrice, prev: BigInt(c.prev), next: BigInt(c.next) };
    // An unwritten slot reads as all zeros - the list does not continue there.
    if (link.clearingPriceQ96 === 0n && link.next === 0n) break;
    chain.push(link);
    options.onProgress?.(chain.length);
    block = link.next;
  }
  return chain;
}

/**
 * Read every bid in an auction, in batched multicalls.
 *
 * Bid ids are sequential from 0 to `nextBidId() - 1`, so reading them
 * directly needs no event logs - which matters: free public RPCs refuse
 * `eth_getLogs` on older blocks ("archive requests require a token") or
 * silently return empty results, either of which would make a bidder's bids
 * look like they do not exist.
 */
export async function readAllBids(
  client: BeaconClient,
  auction: Address,
  options: { batchSize?: number; onProgress?: (read: number, total: number) => void } = {},
): Promise<BidData[]> {
  const total = await client.publicClient.readContract({
    address: auction,
    abi: auctionAbi,
    functionName: "nextBidId",
  });
  const batchSize = BigInt(options.batchSize ?? 250);
  const bids: BidData[] = [];
  for (let from = 0n; from < total; from += batchSize) {
    const to = from + batchSize < total ? from + batchSize : total;
    const ids: bigint[] = [];
    for (let id = from; id < to; id++) ids.push(id);
    const results = await client.publicClient.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({
        address: auction,
        abi: auctionAbi,
        functionName: "bids" as const,
        args: [id] as const,
      })),
    });
    results.forEach((raw, i) => bids.push(toBidData(ids[i]!, raw)));
    options.onProgress?.(bids.length, Number(total));
  }
  return bids;
}

/** Every bid id `owner` holds in `auction`, oldest first. */
export async function findBidIds(
  client: BeaconClient,
  auction: Address,
  owner: Address,
  options: { onProgress?: (read: number, total: number) => void } = {},
): Promise<bigint[]> {
  const all = await readAllBids(client, auction, options);
  return all.filter((b) => b.owner.toLowerCase() === owner.toLowerCase()).map((b) => b.id);
}

// --- encoding ----------------------------------------------------------------

export interface SettleTx {
  label: string;
  to: Address;
  data: Hex;
  bidIds: bigint[];
}

export function encodeExit(auction: Address, bidId: bigint, action: BidAction): SettleTx {
  if (action.kind === "exit") {
    return {
      label: `Exit bid #${bidId}`,
      to: auction,
      data: encodeFunctionData({ abi: auctionAbi, functionName: "exitBid", args: [bidId] }),
      bidIds: [bidId],
    };
  }
  if (action.kind === "exitPartial") {
    return {
      label: `Exit bid #${bidId} (partial fill)`,
      to: auction,
      data: encodeFunctionData({
        abi: auctionAbi,
        functionName: "exitPartiallyFilledBid",
        args: [bidId, action.hints.lastFullyFilledCheckpointBlock, action.hints.outbidBlock],
      }),
      bidIds: [bidId],
    };
  }
  throw new Error(`Bid #${bidId} needs no exit (${action.kind}).`);
}

/** One transaction claims every listed bid; they must share an owner. */
export function encodeClaim(auction: Address, owner: Address, bidIds: readonly bigint[]): SettleTx {
  return {
    label: `Claim tokens for bid${bidIds.length > 1 ? "s" : ""} #${bidIds.join(", #")}`,
    to: auction,
    data:
      bidIds.length === 1
        ? encodeFunctionData({ abi: auctionAbi, functionName: "claimTokens", args: [bidIds[0]!] })
        : encodeFunctionData({ abi: auctionAbi, functionName: "claimTokensBatch", args: [owner, [...bidIds]] }),
    bidIds: [...bidIds],
  };
}

// --- planning ----------------------------------------------------------------

export interface BidPlan {
  bid: BidData;
  action: BidAction;
}

export interface SettlementPlan {
  state: AuctionSettleState;
  bids: BidPlan[];
  /** Exits to send first. */
  exits: SettleTx[];
  /** Claim for bids already exited with tokens owed. Bids exited by `exits` get theirs on a re-plan. */
  claim?: SettleTx;
}

/**
 * Read every listed bid, decide what each needs, and encode the transactions.
 * The checkpoint chain is walked once, from the earliest bid that needs it.
 */
export async function planSettlement(
  client: BeaconClient,
  auction: Address,
  owner: Address,
  bidIds: readonly bigint[],
  state: AuctionSettleState,
  options: { onProgress?: (message: string) => void } = {},
): Promise<SettlementPlan> {
  const bids = await Promise.all(bidIds.map((id) => getBid(client, auction, id)));

  const needsChain = bids.filter(
    (b) =>
      b.exitedBlock === 0n &&
      state.graduated &&
      (state.headBlock >= state.endBlock
        ? b.maxPriceQ96 <= state.clearingPriceQ96
        : b.maxPriceQ96 < state.clearingPriceQ96),
  );
  let chain: CheckpointLink[] = [];
  if (needsChain.length > 0) {
    const from = needsChain.map((b) => b.startBlock).reduce((a, b) => (a < b ? a : b));
    options.onProgress?.(`reading checkpoints from block ${from}`);
    chain = await readCheckpointChain(client, auction, from, {
      onProgress: (n) => n % 100 === 0 && options.onProgress?.(`${n} checkpoints read`),
    });
  }

  const plans = bids.map((bid) => ({ bid, action: decideBidAction(bid, state, chain) }));
  const exits = plans
    .filter((p) => p.action.kind === "exit" || p.action.kind === "exitPartial")
    .map((p) => encodeExit(auction, p.bid.id, p.action));

  const claimIds = plans
    .filter((p) => p.action.kind === "claim" && p.bid.owner.toLowerCase() === owner.toLowerCase())
    .map((p) => p.bid.id);

  return {
    state,
    bids: plans,
    exits,
    claim: claimIds.length > 0 ? encodeClaim(auction, owner, claimIds) : undefined,
  };
}

/** Read the auction-level facts settling depends on. */
export async function readSettleState(
  client: BeaconClient,
  auction: Address,
  live: { clearingPriceQ96: bigint; graduated: boolean; endBlock: bigint },
): Promise<AuctionSettleState> {
  const [headBlock, claimBlock] = await Promise.all([
    client.publicClient.getBlockNumber(),
    client.publicClient.readContract({ address: auction, abi: auctionAbi, functionName: "claimBlock" }),
  ]);
  return {
    headBlock,
    endBlock: live.endBlock,
    claimBlock: BigInt(claimBlock),
    graduated: live.graduated,
    clearingPriceQ96: live.clearingPriceQ96,
  };
}
