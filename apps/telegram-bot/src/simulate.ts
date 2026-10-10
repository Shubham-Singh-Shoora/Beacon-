/**
 * Scripted state changes pushed through the real alert pipeline.
 *
 * The offline fixture needs no network. Online simulation can use real auction
 * metadata, but every state transition remains fictional and every message is
 * explicitly labeled. Both modes exercise the real rule engine and renderer.
 */
import { BLOCK_TIME_SECONDS, decimalToQ96 } from "@hammerock/cca-sdk";
import { zeroAddress } from "viem";
import { sepolia } from "viem/chains";
import { evaluateAlerts } from "./alerts";
import type { AlertThresholds, AuctionSnapshot } from "./alerts";
import { renderAlert } from "./format";
import type { AuctionView } from "./format";
import type { AlertSink } from "./sink";

/** Deliberately fictional. No RPC, credentials, wallet, or live auction needed. */
export function offlineDemo(): AuctionView {
  const auction = "0x0000000000000000000000000000000000000001";
  const token = "0x0000000000000000000000000000000000000002";
  return {
    chain: sepolia,
    token: {
      address: token,
      name: "Simulation token",
      symbol: "DEMO",
      decimals: 18,
      isNative: false,
    },
    currency: { address: zeroAddress, name: "Ether", symbol: "ETH", decimals: 18, isNative: true },
    summary: {
      info: {
        auction,
        token,
        currency: zeroAddress,
        totalSupply: 10n ** 24n,
        startBlock: 100n,
        endBlock: 400n,
        floorPriceQ96: 1n,
        tickSpacing: 1n,
      },
      state: {
        checkpoint: {
          clearingPriceQ96: 1n,
          currencyRaisedAtClearingPriceQ96X7: 0n,
          cumulativeMpsPerPrice: 0n,
          cumulativeMps: 0,
          prevBlock: 0n,
          nextBlock: 0n,
        },
        currencyRaised: 0n,
        totalCleared: 0n,
        isGraduated: false,
      },
      blockNumber: 99n,
      status: "pending",
      clearingPrice: "0",
      supplyScheduleProgress: 0,
      hasClearedSupply: false,
      blocksRemaining: 1n,
      secondsRemaining: 12,
    },
  };
}

/** Build a view whose summary reflects a synthetic snapshot, for rendering. */
function viewWithSnapshot(base: AuctionView, snapshot: AuctionSnapshot): AuctionView {
  const totalCleared = snapshot.hasClearedSupply ? base.summary.info.totalSupply / 4n : 0n;
  return {
    ...base,
    summary: {
      ...base.summary,
      status: snapshot.status,
      supplyScheduleProgress: snapshot.supplyScheduleProgress,
      hasClearedSupply: snapshot.hasClearedSupply,
      secondsRemaining: snapshot.secondsRemaining,
      blocksRemaining: BigInt(
        Math.round(snapshot.secondsRemaining / (BLOCK_TIME_SECONDS[base.chain.id] ?? 12)),
      ),
      state: {
        ...base.summary.state,
        isGraduated: snapshot.isGraduated,
        // Illustrative amount at the scripted price, in the currency's base units.
        currencyRaised: (totalCleared * snapshot.clearingPriceQ96) / (1n << 96n),
        totalCleared,
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
  const priceAbove = thresholds.priceAboveQ96 ?? decimalToQ96("0.0001");
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
    console.log(`  (BEACON_ALERT_PRICE_ABOVE is unset - simulating against a default threshold)`);
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
      await sink.send(
        "<b>SIMULATION — scripted activity, not a live alert</b>\n\n" +
          renderAlert(alert, viewWithSnapshot(base, step.snapshot)),
      );
      sent++;
    }
    previous = step.snapshot;
  }

  return sent;
}
