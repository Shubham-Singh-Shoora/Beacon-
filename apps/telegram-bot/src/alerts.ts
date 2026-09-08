/**
 * The alert rule engine.
 *
 * Deliberately pure: it takes the previous and current snapshot of an auction
 * and returns the alerts that should fire. No network, no Telegram, no clock.
 * That makes the interesting behaviour - edge-triggering, not re-firing while a
 * condition stays true - directly testable.
 */
import type { Address, AuctionStatus } from "@beacon/cca-sdk";

/** The minimum an alert rule needs to know about an auction at a point in time. */
export interface AuctionSnapshot {
  auction: Address;
  status: AuctionStatus;
  clearingPriceQ96: bigint;
  isGraduated: boolean;
  /**
   * Whether any supply has actually cleared (`totalCleared > 0`).
   * NOT the supply schedule progress - see `supplyScheduleProgress`.
   */
  hasClearedSupply: boolean;
  /** Fraction of the supply SCHEDULE released, in [0, 1]. Not "fraction sold". */
  supplyScheduleProgress: number;
  secondsRemaining: number;
}

export interface AlertThresholds {
  priceAboveQ96?: bigint;
  priceBelowQ96?: bigint;
  minutesLeft?: number;
}

export type AlertKind =
  | "price-above"
  | "price-below"
  | "ending-soon"
  | "graduated"
  | "first-clear"
  | "status-change";

export interface Alert {
  kind: AlertKind;
  auction: Address;
  snapshot: AuctionSnapshot;
  previous?: AuctionSnapshot;
  /** Threshold that triggered this alert, where one applies. */
  thresholdQ96?: bigint;
  minutesLeft?: number;
}

/**
 * Decide which alerts fire on this observation.
 *
 * Every rule is EDGE triggered: it fires on the transition into a condition, not
 * on every poll while the condition holds. Without that a bot watching an
 * auction above its price threshold would message every 15 seconds forever.
 *
 * The first observation of an auction (`previous === undefined`) never fires a
 * threshold crossing, otherwise restarting the bot would spam alerts for
 * conditions that were already true.
 */
export function evaluateAlerts(
  previous: AuctionSnapshot | undefined,
  current: AuctionSnapshot,
  thresholds: AlertThresholds,
): Alert[] {
  if (!previous) return [];

  const alerts: Alert[] = [];
  const base = { auction: current.auction, snapshot: current, previous } as const;

  const { priceAboveQ96, priceBelowQ96, minutesLeft } = thresholds;

  // Clearing price crossed UP through the threshold.
  if (
    priceAboveQ96 !== undefined &&
    previous.clearingPriceQ96 <= priceAboveQ96 &&
    current.clearingPriceQ96 > priceAboveQ96
  ) {
    alerts.push({ ...base, kind: "price-above", thresholdQ96: priceAboveQ96 });
  }

  // Clearing price crossed DOWN through the threshold.
  if (
    priceBelowQ96 !== undefined &&
    previous.clearingPriceQ96 >= priceBelowQ96 &&
    current.clearingPriceQ96 < priceBelowQ96
  ) {
    alerts.push({ ...base, kind: "price-below", thresholdQ96: priceBelowQ96 });
  }

  // Auction is about to close. Only meaningful while it is actually live.
  if (minutesLeft !== undefined && current.status === "live") {
    const windowSeconds = minutesLeft * 60;
    if (previous.secondsRemaining > windowSeconds && current.secondsRemaining <= windowSeconds) {
      alerts.push({ ...base, kind: "ending-soon", minutesLeft });
    }
  }

  // Graduation is a one-way transition, so a simple false -> true edge.
  if (!previous.isGraduated && current.isGraduated) {
    alerts.push({ ...base, kind: "graduated" });
  }

  // The first time any supply actually clears. Distinct from schedule progress.
  if (!previous.hasClearedSupply && current.hasClearedSupply) {
    alerts.push({ ...base, kind: "first-clear" });
  }

  if (previous.status !== current.status) {
    alerts.push({ ...base, kind: "status-change" });
  }

  return alerts;
}

/** True when no rule could ever fire, so the operator can be warned at startup. */
export function hasNoActiveRules(thresholds: AlertThresholds): boolean {
  return (
    thresholds.priceAboveQ96 === undefined &&
    thresholds.priceBelowQ96 === undefined &&
    thresholds.minutesLeft === undefined
  );
}
