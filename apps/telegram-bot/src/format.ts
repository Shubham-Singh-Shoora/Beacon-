/**
 * Telegram message composition.
 *
 * Two things this file is careful about:
 *
 * 1. `supplyScheduleProgress` is the fraction of the supply SCHEDULE released,
 *    not the fraction sold. An auction that ends with zero bids still reports
 *    100%. Copy here never says "sold" when it means "schedule released" - what
 *    actually sold is `totalCleared` / `currencyRaised`.
 *
 * 2. CCA auctions are not always denominated in ETH. Every amount is rendered
 *    with the real symbol and decimals read from the currency contract.
 *
 * Messages use Telegram's HTML parse mode, which needs only three characters
 * escaped, rather than MarkdownV2's eighteen.
 */
import { formatQ96, formatTokenAmount } from "@beacon/cca-sdk";
import type { AuctionSummary, Chain, TokenMetadata } from "@beacon/cca-sdk";
import type { Alert } from "./alerts";

/** An auction plus the currency/token metadata needed to describe it to a human. */
export interface AuctionView {
  summary: AuctionSummary;
  token: TokenMetadata;
  currency: TokenMetadata;
  chain: Chain;
}

/** Escape the three characters Telegram's HTML mode treats as markup. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function explorerUrl(chain: Chain, address: string): string | undefined {
  const base = chain.blockExplorers?.default?.url;
  return base ? `${base}/address/${address}` : undefined;
}

function link(chain: Chain, address: string, label: string): string {
  const url = explorerUrl(chain, address);
  const safeLabel = escapeHtml(label);
  return url ? `<a href="${url}">${safeLabel}</a>` : `<code>${safeLabel}</code>`;
}

/** Render a duration in seconds as e.g. "2h 15m" or "45s". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const total = Math.round(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

const STATUS_LABEL: Record<AuctionSummary["status"], string> = {
  pending: "Pending",
  live: "Live",
  ended: "Ended",
};

/**
 * The shared body describing an auction's current state.
 * Every alert appends this so a reader has full context in one message.
 */
export function renderAuctionBody(view: AuctionView): string {
  const { summary, token, currency, chain } = view;
  const { state, info, status } = summary;

  const lines: string[] = [];

  lines.push(`<b>${escapeHtml(token.symbol)}</b> - ${link(chain, info.auction, shortAddress(info.auction))}`);
  lines.push(`Status: ${STATUS_LABEL[status]}`);
  lines.push(`Clearing price: <b>${escapeHtml(formatQ96(state.checkpoint.clearingPriceQ96))}</b> ${escapeHtml(currency.symbol)} per ${escapeHtml(token.symbol)}`);

  // What actually sold - the honest "how is it doing" number.
  if (summary.hasClearedSupply) {
    lines.push(`Raised: ${escapeHtml(formatTokenAmount(state.currencyRaised, currency))}`);
    lines.push(`Cleared: ${escapeHtml(formatTokenAmount(state.totalCleared, token))} of ${escapeHtml(formatTokenAmount(info.totalSupply, token))}`);
  } else {
    lines.push(`Raised: nothing yet (no supply has cleared)`);
  }

  // Explicitly labelled so it can never be misread as "% sold".
  const schedulePercent = (summary.supplyScheduleProgress * 100).toFixed(2);
  lines.push(`Supply schedule released: ${schedulePercent}% <i>(schedule progress, not amount sold)</i>`);

  lines.push(`Graduated: ${state.isGraduated ? "yes" : "no"}`);

  if (status === "live") {
    lines.push(`Time left: ~${formatDuration(summary.secondsRemaining)} (${summary.blocksRemaining} blocks)`);
  } else if (status === "pending") {
    lines.push(`Starts in: ~${formatDuration(summary.secondsRemaining)} (${summary.blocksRemaining} blocks)`);
  }

  return lines.join("\n");
}

const ALERT_HEADLINE: Record<Alert["kind"], string> = {
  "price-above": "Clearing price rose above threshold",
  "price-below": "Clearing price fell below threshold",
  "ending-soon": "Auction ending soon",
  graduated: "Auction graduated",
  "first-clear": "First supply cleared",
  "status-change": "Auction status changed",
};

/** Compose the full Telegram message for one alert. */
export function renderAlert(alert: Alert, view: AuctionView): string {
  const { currency, token } = view;
  const headline = ALERT_HEADLINE[alert.kind];

  const detail: string[] = [];

  switch (alert.kind) {
    case "price-above":
    case "price-below": {
      const threshold = alert.thresholdQ96 !== undefined ? formatQ96(alert.thresholdQ96) : "?";
      const from = alert.previous ? formatQ96(alert.previous.clearingPriceQ96) : "?";
      const to = formatQ96(alert.snapshot.clearingPriceQ96);
      detail.push(
        `Threshold ${escapeHtml(threshold)} ${escapeHtml(currency.symbol)} - moved ${escapeHtml(from)} → ${escapeHtml(to)}`,
      );
      break;
    }
    case "ending-soon":
      detail.push(
        `Under ${alert.minutesLeft} minutes remain (~${formatDuration(alert.snapshot.secondsRemaining)}).`,
      );
      break;
    case "graduated":
      detail.push(`It raised enough to seed the pool.`);
      break;
    case "first-clear":
      detail.push(
        `The first ${escapeHtml(token.symbol)} has cleared - this auction is now actually selling.`,
      );
      break;
    case "status-change":
      detail.push(
        `${STATUS_LABEL[alert.previous?.status ?? "pending"]} → <b>${STATUS_LABEL[alert.snapshot.status]}</b>`,
      );
      break;
  }

  return [`<b>${escapeHtml(headline)}</b>`, ...detail, "", renderAuctionBody(view)].join("\n");
}

/** The `/status` response for one auction. */
export function renderStatus(view: AuctionView): string {
  return renderAuctionBody(view);
}

/** A compact one-line summary, for `/list`. */
export function renderListEntry(view: AuctionView): string {
  const { summary, token, currency, chain } = view;
  const price = formatQ96(summary.state.checkpoint.clearingPriceQ96);
  return (
    `${link(chain, summary.info.auction, shortAddress(summary.info.auction))} ` +
    `<b>${escapeHtml(token.symbol)}</b> - ${STATUS_LABEL[summary.status]}, ` +
    `${escapeHtml(price)} ${escapeHtml(currency.symbol)}` +
    `${summary.state.isGraduated ? ", graduated" : ""}`
  );
}
