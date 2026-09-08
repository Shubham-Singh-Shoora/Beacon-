/**
 * The polling loop: read auction state through the SDK, diff it against the
 * previous observation, and hand any resulting alerts to a sink.
 *
 * All contract interaction goes through @beacon/cca-sdk. Nothing here builds a
 * call or decodes an event itself.
 */
import {
  deriveStatus,
  getAuctionSummary,
  getAuctionSummaries,
  getTokenMetadata,
  isFailedSummary,
} from "@beacon/cca-sdk";
import type { Address, AuctionInfo, BeaconClient, TokenMetadata } from "@beacon/cca-sdk";
import { JsonAuctionStore } from "@beacon/cca-sdk/node";
import { evaluateAlerts } from "./alerts";
import type { Alert, AlertThresholds, AuctionSnapshot } from "./alerts";
import type { AuctionView } from "./format";

export interface WatcherOptions {
  thresholds: AlertThresholds;
  onLog?: (message: string) => void;
}

/** One auction from the shared store, ready to show a user. */
export interface StoreAuction {
  auction: Address;
  info: AuctionInfo;
  token: TokenMetadata;
  currency: TokenMetadata;
  createdBlock: bigint;
}

/**
 * Read the auction catalogue from the SAME persistent store the web directory
 * uses (`data/auctions.sepolia.json`).
 *
 * The bot used to run a full `AuctionCreated` scan on every startup. That is
 * 1.5M blocks of `eth_getLogs`, which is slow, hammers the RPC, and - on the
 * only endpoint that permits wide ranges - silently returns incomplete results.
 * The store is built once by `pnpm sync:auctions` and shared, so startup is a
 * file read.
 */
export async function loadAuctionCatalogue(
  storePath: string,
  options: { onLog?: (message: string) => void } = {},
): Promise<Map<string, StoreAuction>> {
  const snapshot = await new JsonAuctionStore(storePath).read();
  const catalogue = new Map<string, StoreAuction>();

  if (!snapshot) {
    options.onLog?.(
      `No auction store at ${storePath}. Run \`pnpm sync:auctions\` to build it.`,
    );
    return catalogue;
  }

  let incomplete = 0;
  for (const record of snapshot.auctions) {
    if (!record.info || !record.tokenMeta || !record.currencyMeta) {
      incomplete++;
      continue;
    }
    catalogue.set(record.auction.toLowerCase(), {
      auction: record.auction,
      info: record.info,
      token: record.tokenMeta,
      currency: record.currencyMeta,
      createdBlock: record.blockNumber,
    });
  }

  options.onLog?.(
    `Loaded ${catalogue.size} auctions from the store (synced to block ${snapshot.lastSyncedBlock})` +
      (incomplete > 0 ? `; ${incomplete} lack cached config - re-run \`pnpm sync:auctions\`` : ""),
  );

  return catalogue;
}

/**
 * Suggest auctions worth watching: live first, then upcoming, then most
 * recently created. Used by `/suggest` so a user has something to `/watch`.
 */
export function suggestAuctions(
  catalogue: Map<string, StoreAuction>,
  headBlock: bigint,
  limit = 5,
): StoreAuction[] {
  const ranked = [...catalogue.values()]
    .map((entry) => {
      const status = deriveStatus(entry.info, headBlock);
      return { entry, rank: status === "live" ? 0 : status === "pending" ? 1 : 2 };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.entry.createdBlock > b.entry.createdBlock ? -1 : 1;
    });

  return ranked.slice(0, limit).map((r) => r.entry);
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
  /** Read current state for these auctions, and return alerts from any change. */
  tick(auctions: readonly Address[]): Promise<{
    alerts: Array<{ alert: Alert; view: AuctionView }>;
    views: Map<string, AuctionView>;
  }>;
  /** Current views without diffing, for /status. */
  viewsFor(auctions: readonly Address[]): Promise<AuctionView[]>;
  /** Drop remembered state so an unwatched auction does not leak memory. */
  forget(auction: Address): void;
}

export function createWatcher(
  client: BeaconClient,
  catalogue: Map<string, StoreAuction>,
  options: WatcherOptions,
): Watcher {
  const previous = new Map<string, AuctionSnapshot>();
  const tokenCache = new Map<string, TokenMetadata>();

  async function metadata(address: Address): Promise<TokenMetadata> {
    const key = address.toLowerCase();
    const cached = tokenCache.get(key);
    if (cached) return cached;
    const fetched = await getTokenMetadata(client, address);
    tokenCache.set(key, fetched);
    return fetched;
  }

  async function buildViews(auctions: readonly Address[]): Promise<Map<string, AuctionView>> {
    const views = new Map<string, AuctionView>();
    if (auctions.length === 0) return views;

    // The store already has each auction's immutable config, so pass it in and
    // skip re-reading it from chain.
    const summaries = await getAuctionSummaries(client, auctions);

    for (const summary of summaries) {
      if (isFailedSummary(summary)) {
        options.onLog?.(
          `Failed to read ${summary.auction}: ${summary.error.message.split("\n")[0]}`,
        );
        continue;
      }

      const cached = catalogue.get(summary.info.auction.toLowerCase());
      const [token, currency] = await Promise.all([
        cached?.token ?? metadata(summary.info.token),
        cached?.currency ?? metadata(summary.info.currency),
      ]);

      views.set(summary.info.auction.toLowerCase(), {
        summary,
        token,
        currency,
        chain: client.chain,
      });
    }

    return views;
  }

  return {
    forget(auction) {
      previous.delete(auction.toLowerCase());
    },

    async viewsFor(auctions) {
      return [...(await buildViews(auctions)).values()];
    },

    async tick(auctions) {
      const views = await buildViews(auctions);
      const alerts: Array<{ alert: Alert; view: AuctionView }> = [];

      for (const view of views.values()) {
        const key = view.summary.info.auction.toLowerCase();
        const current = toSnapshot(view);
        const fired = evaluateAlerts(previous.get(key), current, options.thresholds);
        previous.set(key, current);
        for (const alert of fired) alerts.push({ alert, view });
      }

      return { alerts, views };
    },
  };
}

export { getAuctionSummary };
