/**
 * Server-side data layer for the directory.
 *
 * SERVER ONLY. `BEACON_RPC_URL` carries an API key, so it must never be exposed
 * as a `NEXT_PUBLIC_` variable. Every function here runs in a Server Component
 * or a Route Handler; the browser talks to our own API routes, never to the RPC
 * provider directly.
 *
 * All contract interaction goes through @beacon/cca-sdk. There is deliberately
 * no indexing logic in this app: discovery comes from the SDK's auction store,
 * live state from the SDK's read functions.
 */
import { resolve } from "node:path";
import {
  createBeaconClient,
  deriveStatus,
  getAuctionListStates,
  getAuctionState,
  getAuctionSummary,
} from "@beacon/cca-sdk";
import type { AuctionRecord } from "@beacon/cca-sdk/node";
import { JsonAuctionStore } from "@beacon/cca-sdk/node";
import type {
  Address,
  AuctionInfo,
  AuctionListState,
  AuctionStatus,
  BeaconClient,
  TokenMetadata,
} from "@beacon/cca-sdk";

const DEFAULT_STORE_PATH = "../../data/auctions.sepolia.json";

let cachedClient: BeaconClient | undefined;

export function getClient(): BeaconClient {
  if (!cachedClient) {
    const rpcUrl = process.env.BEACON_RPC_URL;
    if (!rpcUrl) {
      throw new Error(
        "BEACON_RPC_URL is not set. Copy .env.example to .env at the repo root and fill it in.",
      );
    }
    cachedClient = createBeaconClient({
      rpcUrl,
      logsRpcUrl: process.env.BEACON_LOGS_RPC_URL,
      chainId: Number(process.env.BEACON_CHAIN_ID ?? 11155111),
      lensAddress: (process.env.BEACON_LENS_ADDRESS as Address) || undefined,
    });
  }
  return cachedClient;
}

function getStore(): JsonAuctionStore {
  const path = process.env.BEACON_STORE_PATH ?? DEFAULT_STORE_PATH;
  return new JsonAuctionStore(resolve(process.cwd(), path));
}

/** One row of the directory: everything renderable without touching the chain. */
export interface DirectoryEntry {
  auction: Address;
  createdBlock: bigint;
  info: AuctionInfo;
  token: TokenMetadata;
  currency: TokenMetadata;
  status: AuctionStatus;
}

export interface DirectoryData {
  entries: DirectoryEntry[];
  headBlock: bigint;
  counts: Record<AuctionStatus | "all" | "graduated", number>;
  /** True when the store has never been synced. */
  empty: boolean;
  lastSyncedBlock: bigint;
}

function toEntry(record: AuctionRecord, headBlock: bigint): DirectoryEntry | null {
  // Records without cached config cannot be classified; `pnpm sync` fills these.
  if (!record.info || !record.tokenMeta || !record.currencyMeta) return null;
  return {
    auction: record.auction,
    createdBlock: record.blockNumber,
    info: record.info,
    token: record.tokenMeta,
    currency: record.currencyMeta,
    status: deriveStatus(record.info, headBlock),
  };
}

/**
 * The full directory, newest first.
 *
 * Reads the store (no RPC) plus one `eth_blockNumber` to classify status. Live
 * state is fetched separately, only for the rows actually being shown.
 */
export async function getDirectory(): Promise<DirectoryData> {
  const client = getClient();
  const snapshot = await getStore().read();

  if (!snapshot || snapshot.auctions.length === 0) {
    return {
      entries: [],
      headBlock: 0n,
      counts: { all: 0, live: 0, pending: 0, ended: 0, graduated: 0 },
      empty: true,
      lastSyncedBlock: 0n,
    };
  }

  const headBlock = await client.publicClient.getBlockNumber();

  const entries = snapshot.auctions
    .map((record) => toEntry(record, headBlock))
    .filter((entry): entry is DirectoryEntry => entry !== null)
    .reverse();

  const counts = {
    all: entries.length,
    live: entries.filter((e) => e.status === "live").length,
    pending: entries.filter((e) => e.status === "pending").length,
    ended: entries.filter((e) => e.status === "ended").length,
    // Graduation is live state, filled in by the caller for visible rows only.
    graduated: 0,
  };

  return {
    entries,
    headBlock,
    counts,
    empty: false,
    lastSyncedBlock: snapshot.lastSyncedBlock,
  };
}

/**
 * Cheap live state for a page of auctions, in a single multicall.
 * Used for list rows; the detail page uses the lens instead.
 */
export async function getListStates(
  auctions: readonly Address[],
): Promise<Map<Address, AuctionListState>> {
  if (auctions.length === 0) return new Map();
  try {
    return await getAuctionListStates(getClient(), auctions);
  } catch {
    // A directory that renders without live numbers beats a 500.
    return new Map();
  }
}

export interface AuctionDetail {
  entry: DirectoryEntry;
  summary: Awaited<ReturnType<typeof getAuctionSummary>>;
}

/** Full detail for one auction, using the lens for the freshest state. */
export async function getAuctionDetail(address: Address): Promise<AuctionDetail | null> {
  const client = getClient();
  const snapshot = await getStore().read();
  const record = snapshot?.auctions.find(
    (candidate) => candidate.auction.toLowerCase() === address.toLowerCase(),
  );

  const headBlock = await client.publicClient.getBlockNumber();

  // Fall back to reading config straight from the chain for an auction the
  // store has not seen yet - a brand new one, or an address typed by hand.
  const summary = await getAuctionSummary(client, address, {
    info: record?.info,
    blockNumber: headBlock,
  });

  const { getTokenMetadata } = await import("@beacon/cca-sdk");
  const [token, currency] = await Promise.all([
    record?.tokenMeta ?? getTokenMetadata(client, summary.info.token),
    record?.currencyMeta ?? getTokenMetadata(client, summary.info.currency),
  ]);

  return {
    entry: {
      auction: address,
      createdBlock: record?.blockNumber ?? 0n,
      info: summary.info,
      token,
      currency,
      status: summary.status,
    },
    summary,
  };
}

/** Live state for the detail page's polling endpoint. */
export async function getLiveState(address: Address) {
  const client = getClient();
  const [state, headBlock] = await Promise.all([
    getAuctionState(client, address),
    client.publicClient.getBlockNumber(),
  ]);
  return { state, headBlock };
}

export function explorerUrl(path: string): string {
  const base = getClient().chain.blockExplorers?.default?.url ?? "https://sepolia.etherscan.io";
  return `${base}${path}`;
}
