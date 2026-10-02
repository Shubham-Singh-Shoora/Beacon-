/**
 * Scripted state changes pushed through the real alert pipeline.
 *
 * Every CCA auction currently on Sepolia has already ended, so there is nothing
 * live whose clearing price can actually move. Rather than ship an alert path
 * that has never produced a message, this drives the genuine rule engine and the
 * genuine renderer with a real auction's real token/currency metadata, and
 * delivers through the configured sink.
 *
 * Only the snapshot sequence is synthetic. The rules, the copy, the symbols and
 * the delivery are all the production path. Once Phase 5 deploys a live auction
 * this becomes redundant for the demo, but stays useful as a smoke test.
 */
import { decimalToQ96 } from "@hammerock/cca-sdk";
import { evaluateAlerts } from "./alerts";
import type { AlertThresholds, AuctionSnapshot } from "./alerts";
import { renderAlert } from "./format";
import type { AuctionView } from "./format";
import type { AlertSink } from "./sink";

/** Build a view whose summary reflects a synthetic snapshot, for rendering. */
function viewWithSnapshot(base: AuctionView, snapshot: AuctionSnapshot): AuctionView {
  return {
    ...base,
    summary: {
      ...base.summary,
      status: snapshot.status,
      supplyScheduleProgress: snapshot.supplyScheduleProgress,
      hasClearedSupply: snapshot.hasClearedSupply,
      secondsRemaining: snapshot.secondsRemaining,
      blocksRemaining: BigInt(Math.round(snapshot.secondsRemaining / 12)),
      state: {
        ...base.summary.state,
        isGraduated: snapshot.isGraduated,
        // Show plausible non-zero amounts once supply has cleared.
        currencyRaised: snapshot.hasClearedSupply ? base.summary.info.totalSupply / 40n : 0n,
        totalCleared: snapshot.hasClearedSupply ? base.summary.info.totalSupply / 4n : 0n,
        checkpoint: {
          ...base.summary.state.checkpoint,
          clearingPriceQ96: snapshot.clearingPriceQ96,
        },
      },
    },
  };
}

export async function runSimulation(
  base: AuctionView,
  thresholds: AlertThresholds,
  sink: AlertSink,
): Promise<number> {
  const auction = base.summary.info.auction;

  // Anchor the script to the operator's own threshold when they set one, so the
  // crossing they configured is the crossing they see.
  const priceAbove = thresholds.priceAboveQ96 ?? decimalToQ96("0.000000000000002");
  const below = priceAbove / 2n;
  const above = priceAbove * 2n;
  const minutesLeft = thresholds.minutesLeft ?? 15;

  // The scripted prices are built around `priceAbove`, so the rules must be
  // evaluated against that same threshold. Otherwise an operator who has not set
  // BEACON_ALERT_PRICE_ABOVE watches the price cross and sees nothing fire,
  // which is precisely the behaviour this mode exists to demonstrate.
  const effectiveThresholds: AlertThresholds = {
    ...thresholds,
    priceAboveQ96: priceAbove,
    minutesLeft,
  };
  if (thresholds.priceAboveQ96 === undefined) {
    console.log(
      `  (BEACON_ALERT_PRICE_ABOVE is unset - simulating against a default threshold)`,
    );
  }

  const script: Array<{ label: string; snapshot: AuctionSnapshot }> = [
    {
      label: "auction opens",
      snapshot: {
        auction,
        status: "pending",
        clearingPriceQ96: below,
        isGraduated: false,
        hasClearedSupply: false,
        supplyScheduleProgress: 0,
        secondsRemaining: 3_600,
      },
    },
    {
      label: "goes live",
      snapshot: {
        auction,
        status: "live",
        clearingPriceQ96: below,
        isGraduated: false,
        hasClearedSupply: false,
        supplyScheduleProgress: 0.05,
        secondsRemaining: 3_600,
      },
    },
    {
      label: "first bids clear",
      snapshot: {
        auction,
        status: "live",
        clearingPriceQ96: below,
        isGraduated: false,
        hasClearedSupply: true,
        supplyScheduleProgress: 0.2,
        secondsRemaining: 2_700,
      },
    },
    {
      label: "price crosses the threshold",
      snapshot: {
        auction,
        status: "live",
        clearingPriceQ96: above,
        isGraduated: false,
        hasClearedSupply: true,
        supplyScheduleProgress: 0.5,
        secondsRemaining: 1_800,
      },
    },
    {
      label: "auction graduates",
      snapshot: {
        auction,
        status: "live",
        clearingPriceQ96: above,
        isGraduated: true,
        hasClearedSupply: true,
        supplyScheduleProgress: 0.7,
        secondsRemaining: 1_500,
      },
    },
    {
      label: "closing window",
      snapshot: {
        auction,
        status: "live",
        clearingPriceQ96: above,
        isGraduated: true,
        hasClearedSupply: true,
        supplyScheduleProgress: 0.9,
        secondsRemaining: minutesLeft * 60 - 30,
      },
    },
    {
      label: "auction ends",
      snapshot: {
        auction,
        status: "ended",
        clearingPriceQ96: above,
        isGraduated: true,
        hasClearedSupply: true,
        supplyScheduleProgress: 1,
        secondsRemaining: 0,
      },
    },
  ];

  let sent = 0;
  let previous: AuctionSnapshot | undefined;

  for (const step of script) {
    const alerts = evaluateAlerts(previous, step.snapshot, effectiveThresholds);
    console.log(
      `  ${step.label.padEnd(30)} -> ${alerts.length === 0 ? "no alert" : alerts.map((a) => a.kind).join(", ")}`,
    );

    for (const alert of alerts) {
      await sink.send(renderAlert(alert, viewWithSnapshot(base, step.snapshot)));
      sent++;
    }
    previous = step.snapshot;
  }

  return sent;
}
