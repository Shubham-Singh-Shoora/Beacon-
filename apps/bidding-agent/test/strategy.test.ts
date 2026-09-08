import { decimalToQ96, formatQ96, Q96 } from "@beacon/cca-sdk";
import { describe, expect, it } from "vitest";
import { applyBid, decide, remainingBudget, triggerThresholdQ96 } from "../src/strategy";
import type { MarketSnapshot, StrategyConfig, StrategyState } from "../src/strategy";

const CAP = decimalToQ96("0.001");
const FLOOR = decimalToQ96("0.0000001");

const config = (overrides: Partial<StrategyConfig> = {}): StrategyConfig => ({
  maxPriceQ96: CAP,
  bidAmount: 10n ** 15n,
  triggerBps: 1_000, // 10%
  maxSpend: 10n ** 16n, // room for 10 bids
  maxBids: 3,
  ...overrides,
});

const fresh = (): StrategyState => ({ spent: 0n, bidsPlaced: 0 });

const market = (overrides: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  status: "live",
  clearingPriceQ96: CAP,
  floorPriceQ96: FLOOR,
  ...overrides,
});

describe("triggerThresholdQ96", () => {
  it("is the cap reduced by the trigger band", () => {
    // 10% below 0.001 is 0.0009.
    expect(formatQ96(triggerThresholdQ96(CAP, 1_000))).toBe("0.0009");
    expect(triggerThresholdQ96(CAP, 0)).toBe(CAP);
  });

  it("truncates DOWN, so the agent can only trigger earlier, never higher", () => {
    // An odd cap that does not divide evenly by the basis-point denominator.
    const odd = Q96 * 3n + 7n;
    const threshold = triggerThresholdQ96(odd, 3_333);
    expect(threshold).toBe((odd * 6667n) / 10_000n);
    // Never above the cap - that is the direction that matters.
    expect(threshold).toBeLessThanOrEqual(odd);
  });

  it("clamps a nonsensical band instead of producing a negative threshold", () => {
    expect(triggerThresholdQ96(CAP, 20_000)).toBe(0n);
    expect(triggerThresholdQ96(CAP, -50)).toBe(CAP);
  });
});

describe("decide - lifecycle", () => {
  it("waits while the auction is pending or ended", () => {
    expect(decide(market({ status: "pending" }), config(), fresh()).action).toBe("wait");
    expect(decide(market({ status: "ended" }), config(), fresh()).action).toBe("wait");
  });
});

describe("decide - price cap", () => {
  it("bids when the clearing price is inside the trigger band and under the cap", () => {
    const decision = decide(
      market({ clearingPriceQ96: decimalToQ96("0.00095") }),
      config(),
      fresh(),
    );
    expect(decision.action).toBe("bid");
    if (decision.action === "bid") {
      // Always the operator's ceiling, never the market price.
      expect(decision.maxPriceQ96).toBe(CAP);
      expect(decision.amount).toBe(config().bidAmount);
    }
  });

  it("waits while the price is still below the trigger band", () => {
    const decision = decide(
      market({ clearingPriceQ96: decimalToQ96("0.0005") }),
      config(),
      fresh(),
    );
    expect(decision.action).toBe("wait");
    expect(decision.reason).toMatch(/trigger band/i);
  });

  it("bids exactly AT the threshold", () => {
    const threshold = triggerThresholdQ96(CAP, 1_000);
    expect(decide(market({ clearingPriceQ96: threshold }), config(), fresh()).action).toBe("bid");
  });

  it("still bids when the price sits exactly at the cap", () => {
    // At the cap the bid can still fill at that price, so this is not an overpay.
    expect(decide(market({ clearingPriceQ96: CAP }), config(), fresh()).action).toBe("bid");
  });

  it("REFUSES once the clearing price is one wei-of-Q96 above the cap", () => {
    const decision = decide(market({ clearingPriceQ96: CAP + 1n }), config(), fresh());
    expect(decision.action).toBe("wait");
    expect(decision.reason).toMatch(/above the configured maximum/i);
  });

  it("waits when the cap is below the auction's floor price", () => {
    const decision = decide(
      market({ clearingPriceQ96: FLOOR, floorPriceQ96: decimalToQ96("0.01") }),
      config(),
      fresh(),
    );
    expect(decision.action).toBe("wait");
    expect(decision.reason).toMatch(/floor/i);
  });
});

describe("decide - hard guardrails", () => {
  it("stops at the bid limit even when the market is perfect", () => {
    const decision = decide(market(), config({ maxBids: 2 }), { spent: 0n, bidsPlaced: 2 });
    expect(decision.action).toBe("wait");
    expect(decision.reason).toMatch(/bid limit/i);
  });

  it("stops when the next bid would breach the spend cap", () => {
    const cfg = config({ bidAmount: 10n ** 15n, maxSpend: 15n * 10n ** 14n });
    // 0.0015 spent of a 0.0015 cap: no room for another 0.001.
    const decision = decide(market(), cfg, { spent: 10n ** 15n, bidsPlaced: 1 });
    expect(decision.action).toBe("wait");
    expect(decision.reason).toMatch(/spend cap/i);
  });

  it("allows a bid that exactly exhausts the spend cap", () => {
    const cfg = config({ bidAmount: 10n ** 15n, maxSpend: 2n * 10n ** 15n });
    const decision = decide(market(), cfg, { spent: 10n ** 15n, bidsPlaced: 1 });
    expect(decision.action).toBe("bid");
  });

  it("checks the spend cap BEFORE any market condition", () => {
    // Price is above the cap AND the budget is gone; the safety rule wins, so
    // the operator sees the real blocker.
    const decision = decide(
      market({ clearingPriceQ96: CAP * 2n }),
      config({ maxSpend: 1n }),
      fresh(),
    );
    expect(decision.reason).toMatch(/spend cap/i);
  });

  it("never lets accumulated spend exceed the cap across a whole run", () => {
    const cfg = config({ bidAmount: 3n, maxSpend: 10n, maxBids: 100 });
    let state = fresh();
    for (let i = 0; i < 20; i++) {
      const decision = decide(market(), cfg, state);
      if (decision.action !== "bid") break;
      state = applyBid(state, decision.amount);
    }
    // 3 bids of 3 = 9; a fourth would reach 12 and is refused.
    expect(state.spent).toBe(9n);
    expect(state.spent).toBeLessThanOrEqual(cfg.maxSpend);
  });
});

describe("remainingBudget", () => {
  it("never reports a negative budget", () => {
    expect(remainingBudget(config({ maxSpend: 5n }), { spent: 9n, bidsPlaced: 1 })).toBe(0n);
    expect(remainingBudget(config({ maxSpend: 10n }), { spent: 4n, bidsPlaced: 1 })).toBe(6n);
  });
});

describe("price cap rounding direction", () => {
  it("truncates the configured decimal DOWN, so the cap is never raised", () => {
    // 0.0001 is not representable in Q96; decimalToQ96 rounds toward zero.
    const cap = decimalToQ96("0.0001");
    // Reconstructing the decimal gives a hair under, never over.
    expect(cap * 10_000n).toBeLessThanOrEqual(Q96);
  });

  it("a price one unit above the truncated cap is rejected", () => {
    const cap = decimalToQ96("0.0001");
    const decision = decide(market({ clearingPriceQ96: cap + 1n }), config({ maxPriceQ96: cap }), fresh());
    expect(decision.action).toBe("wait");
  });
});
