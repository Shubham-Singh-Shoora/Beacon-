/**
 * Types mirrored from Uniswap/continuous-clearing-auction @ v1.1.0.
 *
 * Field names follow the contracts, with an explicit `Q96` / `X7` suffix added
 * where the contract encodes a fixed-point value, so callers cannot mistake a
 * Q96 price for a plain integer. Use the helpers in `q96.ts` to convert.
 */
import type { Address, Hex } from "viem";

// Re-exported so consumers get Beacon's types and the viem primitives they are
// built from without adding a direct viem import.
export type { Address, Chain, Hex } from "viem";

/**
 * A checkpoint of auction state at a given block.
 * Mirrors `struct Checkpoint` in `libraries/CheckpointLib.sol`.
 */
export interface Checkpoint {
  /** Price the auction is currently clearing at, Q96-encoded. */
  clearingPriceQ96: bigint;
  /** Currency raised so far at the clearing price. Q96, then X7-scaled. */
  currencyRaisedAtClearingPriceQ96X7: bigint;
  /** Running sum of the ratio between mps and price. */
  cumulativeMpsPerPrice: bigint;
  /**
   * How much of the auction's supply SCHEDULE has been released so far, in
   * milli-bips out of `MPS` (1e7).
   *
   * This is emphatically NOT "tokens sold": an auction that ended with zero
   * bids still reports `cumulativeMps == MPS`, because the schedule fully
   * elapsed. Use `totalCleared` / `currencyRaised` for what actually sold.
   */
  cumulativeMps: number;
  /** Block number of the previous checkpoint. */
  prevBlock: bigint;
  /** Block number of the next checkpoint. */
  nextBlock: bigint;
}

/**
 * The auction's live state.
 * Mirrors `struct AuctionState` returned by `AuctionStateLens.state()`.
 */
export interface AuctionState {
  checkpoint: Checkpoint;
  /** Total currency raised, in the currency's smallest unit. */
  currencyRaised: bigint;
  /** Total token supply cleared so far, in the token's smallest unit. */
  totalCleared: bigint;
  /** Whether the auction raised enough to seed the pool. */
  isGraduated: boolean;
}

/**
 * Immutable-ish configuration of an auction, read once and safe to cache.
 */
export interface AuctionInfo {
  auction: Address;
  /** The token being sold. */
  token: Address;
  /** The currency bids are denominated in. `address(0)` means native ETH. */
  currency: Address;
  /** Total token supply offered by the auction. */
  totalSupply: bigint;
  /** Block the auction opens for bids. */
  startBlock: bigint;
  /** Block the auction closes. */
  endBlock: bigint;
  /** Lowest price the auction will clear at, Q96-encoded. */
  floorPriceQ96: bigint;
  /** Spacing between initialised price ticks. */
  tickSpacing: bigint;
}

/** Lifecycle position of an auction relative to the current block. */
export type AuctionStatus = "pending" | "live" | "ended";

/**
 * Everything a UI needs about one auction: static config, live state, and the
 * derived values that would otherwise be recomputed in four places.
 */
export interface AuctionSummary {
  info: AuctionInfo;
  state: AuctionState;
  /** Block this summary was read at. */
  blockNumber: bigint;
  status: AuctionStatus;
  /** Clearing price as a display string. */
  clearingPrice: string;
  /**
   * Fraction of the supply schedule released so far, in [0, 1].
   * Not the fraction sold - see `Checkpoint.cumulativeMps`.
   */
  supplyScheduleProgress: number;
  /** Whether anything has actually cleared. `totalCleared > 0`. */
  hasClearedSupply: boolean;
  /**
   * Blocks until the auction ends. `0n` once ended, and counts down to the
   * START block while the auction is still pending.
   */
  blocksRemaining: bigint;
  /** Estimated seconds remaining, from `blocksRemaining` and the chain's block time. */
  secondsRemaining: number;
}

/**
 * One `AuctionCreated` event from the factory.
 * Mirrors `event AuctionCreated(address indexed auction, address indexed token, uint256 amount, bytes configData)`.
 */
export interface DiscoveredAuction {
  /** The newly created ContinuousClearingAuction. */
  auction: Address;
  /** The token being auctioned. */
  token: Address;
  /** Token amount supplied to the auction. */
  amount: bigint;
  /** ABI-encoded `AuctionParameters` the auction was configured with. */
  configData: Hex;
  /**
   * The factory that emitted the event, i.e. which CCA version this auction
   * runs (see `factoryVersionOf`). Absent on records cached before v0.2.
   */
  factory?: Address;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}
