/**
 * The bidding strategy. Pure: no network, no wallet, no clock.
 *
 * Every price comparison happens in Q96 integer space using the SDK's own
 * encoding. Nothing here converts a price to a float. A rounding mistake in
 * this file means overpaying real money, not a cosmetic glitch, so the
 * direction of every truncation is chosen and asserted deliberately:
 *
 * - The cap comes from `decimalToQ96`, which truncates DOWN, so the effective
 *   ceiling is never above what the operator typed.
 * - The trigger threshold also truncates DOWN, which can only make the agent
 *   bid slightly EARLIER, never at a higher price. The submitted price is the
 *   cap itself, so an early trigger cannot cause an overpay.
 * - The spend check uses `>` on exact bigints, so the cap is a hard ceiling.
 */
import type { AuctionStatus } from "@beacon/cca-sdk";

export interface StrategyConfig {
  /** Hard price ceiling, Q96. The agent never submits a bid above this. */
  maxPriceQ96: bigint;
  /** Per-bid size, in the currency's smallest unit. */
  bidAmount: bigint;
  /** Bid once the clearing price is within this many basis points of the cap. */
  triggerBps: number;
  /** Hard cap on cumulative spend, in the currency's smallest unit. */
  maxSpend: bigint;
  /** Stop after this many bids. */
  maxBids: number;
}

export interface StrategyState {
  /** Currency committed so far this run. */
  spent: bigint;
  bidsPlaced: number;
}

export interface MarketSnapshot {
  status: AuctionStatus;
  clearingPriceQ96: bigint;
  floorPriceQ96: bigint;
}

export type Decision =
  | {
      action: "bid";
      amount: bigint;
      maxPriceQ96: bigint;
      reason: string;
    }
  | { action: "wait"; reason: string };

const BPS = 10_000n;

/**
 * The clearing price at or above which the agent will bid.
 *
 * `maxPrice * (10000 - triggerBps) / 10000`, truncated down. With a 10% trigger
 * and a cap of 0.001, this is 0.0009: the agent acts once the market has come
 * within 10% of its ceiling.
 */
export function triggerThresholdQ96(maxPriceQ96: bigint, triggerBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(triggerBps))));
  return (maxPriceQ96 * (BPS - bps)) / BPS;
}

/** Currency still available under the spend cap. */
export function remainingBudget(config: StrategyConfig, state: StrategyState): bigint {
  const remaining = config.maxSpend - state.spent;
  return remaining > 0n ? remaining : 0n;
}

/**
 * Decide whether to bid on this observation.
 *
 * Ordered so that the hard safety rules (spend cap, bid count) are checked
 * before any market condition. A misconfigured strategy therefore fails closed.
 */
export function decide(
  market: MarketSnapshot,
  config: StrategyConfig,
  state: StrategyState,
): Decision {
  if (market.status === "ended") {
    return { action: "wait", reason: "Auction has ended - bidding is closed." };
  }
  if (market.status === "pending") {
    return { action: "wait", reason: "Auction has not opened yet." };
  }

  // --- hard guardrails, before anything market-dependent -------------------
  if (state.bidsPlaced >= config.maxBids) {
    return {
      action: "wait",
      reason: `Bid limit reached (${state.bidsPlaced}/${config.maxBids}).`,
    };
  }

  const budget = remainingBudget(config, state);
  if (config.bidAmount > budget) {
    return {
      action: "wait",
      reason:
        `Spend cap reached: ${state.spent} of ${config.maxSpend} committed, ` +
        `${budget} left, next bid needs ${config.bidAmount}.`,
    };
  }

  // --- market conditions ---------------------------------------------------
  if (market.clearingPriceQ96 > config.maxPriceQ96) {
    return {
      action: "wait",
      reason: "Clearing price is above the configured maximum - refusing to overpay.",
    };
  }

  if (config.maxPriceQ96 < market.floorPriceQ96) {
    return {
      action: "wait",
      reason: "Configured maximum price is below the auction's floor price.",
    };
  }

  const threshold = triggerThresholdQ96(config.maxPriceQ96, config.triggerBps);
  if (market.clearingPriceQ96 < threshold) {
    return {
      action: "wait",
      reason: "Clearing price has not yet come within the trigger band of the cap.",
    };
  }

  return {
    action: "bid",
    amount: config.bidAmount,
    // Always the operator's ceiling: the auction clears at or below it.
    maxPriceQ96: config.maxPriceQ96,
    reason: "Clearing price is within the trigger band and under the cap.",
  };
}

/** Apply a placed bid to the running state. */
export function applyBid(state: StrategyState, amount: bigint): StrategyState {
  return { spent: state.spent + amount, bidsPlaced: state.bidsPlaced + 1 };
}
