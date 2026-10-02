/**
 * Terminal presentation: colours, the auction card, and log lines.
 *
 * Presentation only. Nothing here reads config or touches the chain, so the
 * runtime in `agent.ts` stays testable without a terminal.
 */
import pc from "picocolors";
import { formatQ96, formatTokenAmount } from "@hammerock/cca-sdk";
import type { AuctionInfo, AuctionState, AuctionStatus, TokenMetadata } from "@hammerock/cca-sdk";

export { pc };

export const BRAND = `${pc.bold(pc.cyan("cca-agent"))} ${pc.dim("· Uniswap CCA bidding agent")}`;

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function statusBadge(status: AuctionStatus): string {
  if (status === "live") return pc.green("● live");
  if (status === "pending") return pc.yellow("◌ not started");
  return pc.dim("○ ended");
}

/** "~2h 13m" from a block count. Block times drift, hence the tilde. */
export function formatDuration(blocks: bigint, secondsPerBlock: number): string {
  const total = Number(blocks) * secondsPerBlock;
  if (total <= 0) return "now";
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.max(1, Math.floor((total % 3_600) / 60));
  if (d > 0) return `~${d}d ${h}h`;
  if (h > 0) return `~${h}h ${m}m`;
  return `~${m}m`;
}

export interface AuctionView {
  info: AuctionInfo;
  state: AuctionState;
  token: TokenMetadata;
  currency: TokenMetadata;
  status: AuctionStatus;
  headBlock: bigint;
  secondsPerBlock: number;
  chainName: string;
}

/** Aligned label/value rows for a clack `note()`. */
export function auctionCard(view: AuctionView): string {
  const { info, state, token, currency, status, headBlock, secondsPerBlock } = view;
  const unit = pc.dim(`${currency.symbol}/${token.symbol}`);

  let timing: string;
  if (status === "pending") {
    timing = `opens in ${formatDuration(info.startBlock - headBlock, secondsPerBlock)}`;
  } else if (status === "live") {
    timing = `closes in ${formatDuration(info.endBlock - headBlock, secondsPerBlock)}`;
  } else {
    timing = `closed at block ${info.endBlock}`;
  }

  const rows: Array<[string, string]> = [
    ["Auction", `${shortAddress(info.auction)} ${pc.dim(`on ${view.chainName}`)}`],
    ["Selling", `${pc.bold(token.symbol)} ${pc.dim(token.name)}`],
    ["Bids in", `${currency.symbol}${currency.isNative ? pc.dim(" (native)") : pc.dim(" (ERC-20 via Permit2)")}`],
    ["Status", `${statusBadge(status)}  ${pc.dim(timing)}`],
    ["Clearing", `${pc.bold(formatQ96(state.checkpoint.clearingPriceQ96))} ${unit}`],
    ["Floor", `${formatQ96(info.floorPriceQ96)} ${unit}`],
    ["Raised", formatTokenAmount(state.currencyRaised, currency)],
    ["Cleared", `${formatTokenAmount(state.totalCleared, token)} of ${formatTokenAmount(info.totalSupply, token)}`],
    ["Graduated", state.isGraduated ? pc.green("yes") : pc.dim("not yet")],
  ];
  return rows.map(([label, value]) => `${pc.dim(label.padEnd(10))} ${value}`).join("\n");
}

function clock(): string {
  return pc.dim(new Date().toLocaleTimeString([], { hour12: false }));
}

/** One line per poll: time, status, price, decision. */
export function cycleLine(input: {
  status: AuctionStatus;
  priceQ96: bigint;
  action: "bid" | "wait";
  reason: string;
}): string {
  const action = input.action === "bid" ? pc.bold(pc.green("BID ")) : pc.dim("wait");
  return `${clock()}  ${statusBadge(input.status)}  ${pc.bold(formatQ96(input.priceQ96))}  ${action} ${pc.dim(input.reason)}`;
}

export function info(message: string): void {
  console.log(`${clock()}  ${message}`);
}
