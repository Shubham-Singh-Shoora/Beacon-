import { decimalToQ96 } from "@beacon/cca-sdk";
import { describe, expect, it } from "vitest";
import { evaluateAlerts, hasNoActiveRules } from "../src/alerts";
import type { AlertThresholds, AuctionSnapshot } from "../src/alerts";

const AUCTION = "0xa26DBABBbF9451F150A87d7635f6891474c4F0FA" as const;

const THRESHOLD = decimalToQ96("0.0001");

function snapshot(overrides: Partial<AuctionSnapshot> = {}): AuctionSnapshot {
  return {
    auction: AUCTION,
    status: "live",
    clearingPriceQ96: decimalToQ96("0.00005"),
    isGraduated: false,
    hasClearedSupply: false,
    supplyScheduleProgress: 0.1,
    secondsRemaining: 3_600,
    ...overrides,
  };
}

const priceRules: AlertThresholds = { priceAboveQ96: THRESHOLD };

describe("evaluateAlerts - first observation", () => {
  it("never fires on the first observation, so a restart does not spam", () => {
    const alerts = evaluateAlerts(
      undefined,
      snapshot({ clearingPriceQ96: decimalToQ96("1"), isGraduated: true, hasClearedSupply: true }),
      { ...priceRules, minutesLeft: 15 },
    );
    expect(alerts).toEqual([]);
  });
});

describe("evaluateAlerts - price crossings", () => {
  it("fires when the clearing price crosses up through the threshold", () => {
    const alerts = evaluateAlerts(
      snapshot({ clearingPriceQ96: decimalToQ96("0.00005") }),
      snapshot({ clearingPriceQ96: decimalToQ96("0.0002") }),
      priceRules,
    );
    expect(alerts.map((a) => a.kind)).toEqual(["price-above"]);
    expect(alerts[0]!.thresholdQ96).toBe(THRESHOLD);
  });

  it("does NOT re-fire while the price stays above the threshold", () => {
    const above = snapshot({ clearingPriceQ96: decimalToQ96("0.0002") });
    const higher = snapshot({ clearingPriceQ96: decimalToQ96("0.0003") });
    expect(evaluateAlerts(above, higher, priceRules)).toEqual([]);
  });

  it("fires again only after the price crosses back down and up", () => {
    const above = snapshot({ clearingPriceQ96: decimalToQ96("0.0002") });
    const below = snapshot({ clearingPriceQ96: decimalToQ96("0.00005") });
    expect(evaluateAlerts(above, below, priceRules)).toEqual([]);
    expect(evaluateAlerts(below, above, priceRules).map((a) => a.kind)).toEqual(["price-above"]);
  });

  it("does not fire when the price merely touches the threshold", () => {
    const below = snapshot({ clearingPriceQ96: decimalToQ96("0.00005") });
    const exactly = snapshot({ clearingPriceQ96: THRESHOLD });
    // Strictly greater than, so landing exactly on the threshold is not a cross.
    expect(evaluateAlerts(below, exactly, priceRules)).toEqual([]);
  });

  it("fires a downward crossing independently", () => {
    const alerts = evaluateAlerts(
      snapshot({ clearingPriceQ96: decimalToQ96("0.0002") }),
      snapshot({ clearingPriceQ96: decimalToQ96("0.00001") }),
      { priceBelowQ96: THRESHOLD },
    );
    expect(alerts.map((a) => a.kind)).toEqual(["price-below"]);
  });

  it("ignores price movement when no price threshold is configured", () => {
    const alerts = evaluateAlerts(
      snapshot({ clearingPriceQ96: 1n }),
      snapshot({ clearingPriceQ96: decimalToQ96("999") }),
      {},
    );
    expect(alerts).toEqual([]);
  });
});

describe("evaluateAlerts - ending soon", () => {
  const rules: AlertThresholds = { minutesLeft: 15 };

  it("fires when the auction crosses into the closing window", () => {
    const alerts = evaluateAlerts(
      snapshot({ secondsRemaining: 20 * 60 }),
      snapshot({ secondsRemaining: 10 * 60 }),
      rules,
    );
    expect(alerts.map((a) => a.kind)).toEqual(["ending-soon"]);
    expect(alerts[0]!.minutesLeft).toBe(15);
  });

  it("does not re-fire as the clock keeps running down", () => {
    expect(
      evaluateAlerts(snapshot({ secondsRemaining: 10 * 60 }), snapshot({ secondsRemaining: 60 }), rules),
    ).toEqual([]);
  });

  it("does not fire for an auction that is not live", () => {
    const alerts = evaluateAlerts(
      snapshot({ status: "pending", secondsRemaining: 20 * 60 }),
      snapshot({ status: "pending", secondsRemaining: 10 * 60 }),
      rules,
    );
    expect(alerts.map((a) => a.kind)).not.toContain("ending-soon");
  });
});

describe("evaluateAlerts - lifecycle", () => {
  it("fires once on graduation", () => {
    const before = snapshot({ isGraduated: false });
    const after = snapshot({ isGraduated: true });
    expect(evaluateAlerts(before, after, {}).map((a) => a.kind)).toEqual(["graduated"]);
    expect(evaluateAlerts(after, after, {})).toEqual([]);
  });

  it("fires when supply first clears, and distinguishes that from schedule progress", () => {
    // Schedule progress moving is NOT a sale, and must not alert on its own.
    const scheduleOnly = evaluateAlerts(
      snapshot({ supplyScheduleProgress: 0.1, hasClearedSupply: false }),
      snapshot({ supplyScheduleProgress: 1, hasClearedSupply: false }),
      {},
    );
    expect(scheduleOnly).toEqual([]);

    // An actual clear does alert.
    const realClear = evaluateAlerts(
      snapshot({ hasClearedSupply: false }),
      snapshot({ hasClearedSupply: true }),
      {},
    );
    expect(realClear.map((a) => a.kind)).toEqual(["first-clear"]);
  });

  it("fires on status transitions", () => {
    const alerts = evaluateAlerts(
      snapshot({ status: "live" }),
      snapshot({ status: "ended", secondsRemaining: 0 }),
      {},
    );
    expect(alerts.map((a) => a.kind)).toEqual(["status-change"]);
    expect(alerts[0]!.previous!.status).toBe("live");
  });

  it("can fire several alerts from one observation", () => {
    const alerts = evaluateAlerts(
      snapshot({ status: "live", clearingPriceQ96: decimalToQ96("0.00001"), hasClearedSupply: false }),
      snapshot({
        status: "ended",
        clearingPriceQ96: decimalToQ96("0.5"),
        isGraduated: true,
        hasClearedSupply: true,
        secondsRemaining: 0,
      }),
      priceRules,
    );
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      "first-clear",
      "graduated",
      "price-above",
      "status-change",
    ]);
  });
});

describe("hasNoActiveRules", () => {
  it("detects a configuration that can never fire a threshold alert", () => {
    expect(hasNoActiveRules({})).toBe(true);
    expect(hasNoActiveRules({ minutesLeft: 15 })).toBe(false);
    expect(hasNoActiveRules({ priceAboveQ96: THRESHOLD })).toBe(false);
  });
});
