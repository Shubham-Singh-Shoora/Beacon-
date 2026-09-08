/**
 * The polling loop: read auction state through the SDK, diff it against the
 * previous observation, and hand any resulting alerts to a sink.
 *
 * All contract interaction goes through @beacon/cca-sdk. Nothing here builds a
 * call or decodes an event itself.
 */
import {
  deriveStatus,
  getAuctionInfo,
  getAuctionSummary,
  getTokenMetadata,
  isFailedSummary,
  getAuctionSummaries,
  scanAuctions,
} from "@beacon/cca-sdk";
import type { Address, AuctionInfo, BeaconClient, TokenMetadata } from "@beacon/cca-sdk";
import { evaluateAlerts } from "./alerts";
import type { Alert, AlertThresholds, AuctionSnapshot } from "./alerts";
import type { AuctionView } from "./format";

export interface WatcherOptions {
  thresholds: AlertThresholds;
  /** How many auctions to auto-select when none are configured. */
  autoSelectLimit: number;
  /** How many recent auctions to inspect when auto-selecting. */
  autoSelectScanDepth?: number;
  onLog?: (message: string) => void;
}

/**
 * Choose which auctions to watch.
 *
 * Prefers auctions that can still change - live first, then pending - and falls
 * back to the most recently created ones so the bot always has something real to
 * report rather than a placeholder address.
 */
export async function resolveWatchList(
  client: BeaconClient,
  configured: readonly Address[],
  options: { limit: number; scanDepth?: number; onLog?: (message: string) => void },
): Promise<{ auctions: Address[]; discovered: number; anomalies: number }> {
  if (configured.length > 0) {
    return { auctions: [...configured], discovered: configured.length, anomalies: 0 };
  }

  let anomalies = 0;
  options.onLog?.("No BEACON_WATCH_AUCTION_ADDRESS set - discovering auctions from the factory...");

  const discovered = await scanAuctions(client, {
    onAnomaly: () => {
      anomalies++;
    },
  });

  if (discovered.length === 0) {
    return { auctions: [], discovered: 0, anomalies };
  }

  options.onLog?.(`Discovered ${discovered.length} auctions via AuctionCreated.`);

  // Newest first, and only inspect a bounded window - classifying all of them
  // would be a lot of RPC calls for little benefit.
  const newestFirst = [...discovered].reverse();
  const window = newestFirst.slice(0, options.scanDepth ?? 30);

  const head = await client.publicClient.getBlockNumber();
  const classified: Array<{ auction: Address; info: AuctionInfo; rank: number }> = [];

  const concurrency = 5;
  for (let i = 0; i < window.length; i += concurrency) {
    const batch = window.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (entry) => {
        try {
          const info = await getAuctionInfo(client, entry.auction);
          return { entry, info };
        } catch {
          return null;
        }
      }),
    );

    for (const result of settled) {
      if (!result) continue;
      const status = deriveStatus(result.info, head);
      // live is most interesting, then pending, then ended.
      const rank = status === "live" ? 0 : status === "pending" ? 1 : 2;
      classified.push({ auction: result.entry.auction, info: result.info, rank });
    }
  }

  classified.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // Within a rank, most recently starting first.
    return a.info.startBlock > b.info.startBlock ? -1 : 1;
  });

  const best = classified.slice(0, options.limit);
  const liveOrPending = classified.filter((c) => c.rank < 2).length;

  if (liveOrPending === 0) {
    options.onLog?.(
      `No live or pending auctions on this network right now - watching the ${best.length} most recent ended auctions instead.`,
    );
  } else {
    options.onLog?.(`${liveOrPending} live/pending auctions found.`);
  }

  return {
    auctions: best.map((c) => c.auction),
    discovered: discovered.length,
    anomalies,
  };
}

function toSnapshot(view: AuctionView): AuctionSnapshot {
  const { summary } = view;
  return {
    auction: summary.info.auction,
    status: summary.status,
    clearingPriceQ96: summary.state.checkpoint.clearingPriceQ96,
    isGraduated: summary.state.isGraduated,
    hasClearedSupply: summary.hasClearedSupply,
    supplyScheduleProgress: summary.supplyScheduleProgress,
    secondsRemaining: summary.secondsRemaining,
  };
}

export interface Watcher {
  /** Auctions currently being watched. */
  readonly watching: Address[];
  add(auction: Address): void;
  remove(auction: Address): boolean;
  /** Read current state and return any alerts the change produced. */
  tick(): Promise<{ alerts: Array<{ alert: Alert; view: AuctionView }>; views: AuctionView[] }>;
  /** Current views without diffing, for /status and /list. */
  snapshotViews(): Promise<AuctionView[]>;
}

export function createWatcher(
  client: BeaconClient,
  initial: readonly Address[],
  options: WatcherOptions,
): Watcher {
  const watching = new Set<Address>(initial);
  const previous = new Map<Address, AuctionSnapshot>();
  // Token metadata is immutable, so read each currency/token exactly once.
  const tokenCache = new Map<Address, TokenMetadata>();

  async function metadata(address: Address): Promise<TokenMetadata> {
    const cached = tokenCache.get(address);
    if (cached) return cached;
    const fetched = await getTokenMetadata(client, address);
    tokenCache.set(address, fetched);
    return fetched;
  }

  async function buildViews(): Promise<AuctionView[]> {
    const auctions = [...watching];
    if (auctions.length === 0) return [];

    const summaries = await getAuctionSummaries(client, auctions);
    const views: AuctionView[] = [];

    for (const summary of summaries) {
      if (isFailedSummary(summary)) {
        options.onLog?.(
          `Failed to read ${summary.auction}: ${summary.error.message.split("\n")[0]}`,
        );
        continue;
      }
      const [token, currency] = await Promise.all([
        metadata(summary.info.token),
        metadata(summary.info.currency),
      ]);
      views.push({ summary, token, currency, chain: client.chain });
    }

    return views;
  }

  return {
    get watching() {
      return [...watching];
    },
    add(auction) {
      watching.add(auction);
    },
    remove(auction) {
      previous.delete(auction);
      return watching.delete(auction);
    },
    async snapshotViews() {
      return buildViews();
    },
    async tick() {
      const views = await buildViews();
      const alerts: Array<{ alert: Alert; view: AuctionView }> = [];

      for (const view of views) {
        const auction = view.summary.info.auction;
        const current = toSnapshot(view);
        const fired = evaluateAlerts(previous.get(auction), current, options.thresholds);
        previous.set(auction, current);
        for (const alert of fired) alerts.push({ alert, view });
      }

      return { alerts, views };
    },
  };
}

/** Re-export so the entry point can prime a watcher without importing the SDK directly. */
export { getAuctionSummary };
