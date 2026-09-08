/**
 * Scripted market movements pushed through the REAL strategy.
 *
 * No auction on Sepolia is currently open, so a real `submitBid` cannot be
 * executed end to end. Rather than ship strategy logic that has never made a
 * decision, this drives the genuine `decide()` function with a sequence of
 * clearing prices and prints what the agent would do at each step, including
 * the spend cap and bid-limit stops.
 *
 * Only the price sequence is synthetic. The strategy, the guardrails and the
 * Q96 comparisons are the production code path.
 */
import { formatQ96, formatTokenAmount } from "@beacon/cca-sdk";
import type { TokenMetadata } from "@beacon/cca-sdk";
import { applyBid, decide, triggerThresholdQ96 } from "./strategy";
import type { StrategyConfig, StrategyState } from "./strategy";

export interface SimulationStep {
  label: string;
  clearingPriceQ96: bigint;
  status: "pending" | "live" | "ended";
}

/** A price walk that crosses the trigger band, then the cap, then closes. */
export function buildScript(config: StrategyConfig, floorPriceQ96: bigint): SimulationStep[] {
  const cap = config.maxPriceQ96;
  const threshold = triggerThresholdQ96(cap, config.triggerBps);

  // Just under the trigger, so the agent should hold.
  const belowTrigger = threshold > 1n ? threshold - threshold / 20n : threshold;
  // Between trigger and cap: the band where it should bid.
  const inBand = threshold + (cap - threshold) / 2n;

  return [
    { label: "auction not open yet", clearingPriceQ96: floorPriceQ96, status: "pending" },
    { label: "opens at the floor", clearingPriceQ96: floorPriceQ96, status: "live" },
    { label: "price rises, still below trigger", clearingPriceQ96: belowTrigger, status: "live" },
    { label: "price enters the trigger band", clearingPriceQ96: inBand, status: "live" },
    { label: "still in band (repeat bids)", clearingPriceQ96: inBand, status: "live" },
    { label: "still in band (repeat bids)", clearingPriceQ96: inBand, status: "live" },
    { label: "still in band (repeat bids)", clearingPriceQ96: inBand, status: "live" },
    { label: "price runs above the cap", clearingPriceQ96: cap + cap / 10n, status: "live" },
    { label: "auction closes", clearingPriceQ96: cap, status: "ended" },
  ];
}

export function runSimulation(
  config: StrategyConfig,
  floorPriceQ96: bigint,
  currency: TokenMetadata,
  log: (message: string) => void,
): { bids: number; spent: bigint } {
  const script = buildScript(config, floorPriceQ96);
  let state: StrategyState = { spent: 0n, bidsPlaced: 0 };

  log(`trigger threshold: ${formatQ96(triggerThresholdQ96(config.maxPriceQ96, config.triggerBps))}`);
  log(`price cap        : ${formatQ96(config.maxPriceQ96)}`);
  log("");

  for (const step of script) {
    const decision = decide(
      { status: step.status, clearingPriceQ96: step.clearingPriceQ96, floorPriceQ96 },
      config,
      state,
    );

    const priceLabel = formatQ96(step.clearingPriceQ96).padEnd(14);
    if (decision.action === "bid") {
      state = applyBid(state, decision.amount);
      log(
        `  ${step.label.padEnd(34)} price=${priceLabel} -> BID ${formatTokenAmount(decision.amount, currency)}` +
          `  (spent ${formatTokenAmount(state.spent, currency)}, ${state.bidsPlaced} bid(s))`,
      );
    } else {
      log(`  ${step.label.padEnd(34)} price=${priceLabel} -> wait: ${decision.reason}`);
    }
  }

  return { bids: state.bidsPlaced, spent: state.spent };
}
