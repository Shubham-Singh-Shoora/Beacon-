/**
 * Server-side data layer for the directory.
 *
 * SERVER ONLY. RPC URLs may carry an API key, so they must never be exposed as
 * `NEXT_PUBLIC_` variables. Every function here runs in a Server Component or a
 * Route Handler; the browser talks to our own API routes, never to the RPC
 * provider directly.
 *
 * Multi-chain: every function takes a network. Each chain has its own client
 * (free default RPC, or BEACON_RPC_URL_<id> + BEACON_FALLBACK_RPC_URL_<id>) and
 * its own committed store, data/auctions.<slug>.json.
 *
 * All contract interaction goes through @hammerock/cca-sdk. There is deliberately
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
  NETWORKS,
  networkBySlug,
  networkFor,
  rpcSettingsFromEnv,
} from "@hammerock/cca-sdk";
import type { AuctionRecord, AuctionStoreSnapshot } from "@hammerock/cca-sdk/node";
import { JsonAuctionStore } from "@hammerock/cca-sdk/node";
import type {
  Address,
  AuctionInfo,
  AuctionListState,
  AuctionStatus,
  BeaconClient,
  NetworkDefaults,
  TokenMetadata,
} from "@hammerock/cca-sdk";

// Keep the interface responsive when a provider is slow.
async function withReadDeadline<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Auction data is temporarily unavailable.")),
          7000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A tiny per-instance TTL cache for live reads. With it, RPC usage scales with
 * the number of auctions shown, not the number of visitors: a burst of page
 * views within one block shares one read. ~15s is about one Ethereum block.
 */
const LIVE_TTL_MS = 15_000;
const liveCache = new Map<string, { expires: number; value: Promise<unknown> }>();
function cachedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = liveCache.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = read();
  liveCache.set(key, { expires: now + LIVE_TTL_MS, value });
  // Never cache a failure - the next request should retry.
  value.catch(() => liveCache.delete(key));
  if (liveCache.size > 2_000) {
    for (const [k, v] of liveCache) if (v.expires <= now) liveCache.delete(k);
  }
  return value;
}

// --- networks ------------------------------------------------------------------

/** Chains this deployment lists. Defaults to the four mainnets plus Sepolia. */
export function listedNetworks(): NetworkDefaults[] {
  const configured = process.env.BEACON_CHAINS?.split(",")
    .map((s) => networkBySlug(s.trim()) ?? networkFor(Number(s.trim())))
    .filter((n): n is NetworkDefaults => n !== undefined);
  if (configured?.length) return configured;
  return Object.values(NETWORKS).filter((n) => !n.testnet || n.slug === "sepolia");
}

/** The chain the directory opens on. BEACON_DEFAULT_CHAIN (slug or id), else Base. */
export function defaultNetwork(): NetworkDefaults {
  const wanted = process.env.BEACON_DEFAULT_CHAIN?.trim() ?? process.env.BEACON_CHAIN_ID?.trim();
  const listed = listedNetworks();
  return (
    (wanted ? listed.find((n) => n.slug === wanted || String(n.chainId) === wanted) : undefined) ??
    listed.find((n) => n.slug === "base") ??
    listed[0]!
  );
}

/** Resolve a `?chain=` value to a listed network, or the default. */
export function resolveNetwork(slug: string | undefined): NetworkDefaults {
  const listed = listedNetworks();
  return (slug && listed.find((n) => n.slug === slug.toLowerCase())) || defaultNetwork();
}

const clients = new Map<number, BeaconClient>();

export function getClient(network: NetworkDefaults): BeaconClient {
  let client = clients.get(network.chainId);
  if (!client) {
    client = createBeaconClient({
      chainId: network.chainId,
      ...rpcSettingsFromEnv(network.chainId),
      lensAddress: (process.env.BEACON_LENS_ADDRESS as Address) || undefined,
    });
    clients.set(network.chainId, client);
  }
  return client;
}

function storePath(network: NetworkDefaults): string {
  // BEACON_STORE_PATH is honoured for the single-chain setup it came from.
  if (process.env.BEACON_STORE_PATH && Number(process.env.BEACON_CHAIN_ID) === network.chainId) {
    return resolve(process.cwd(), process.env.BEACON_STORE_PATH);
  }
  return resolve(process.cwd(), process.env.BEACON_DATA_DIR ?? "../../data", `auctions.${network.slug}.json`);
}

async function readStore(network: NetworkDefaults): Promise<AuctionStoreSnapshot | undefined> {
  return new JsonAuctionStore(storePath(network)).read();
}

// --- directory -------------------------------------------------------------------

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
  network: NetworkDefaults;
  entries: DirectoryEntry[];
  headBlock: bigint;
  counts: Record<AuctionStatus | "all" | "graduated", number>;
  /** True when the store has never been synced. */
  empty: boolean;
  lastSyncedBlock: bigint;
  /** Whether statuses are based on the stored block while RPC is unavailable. */
  isStale: boolean;
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

function headBlockOf(network: NetworkDefaults): Promise<bigint> {
  return cachedRead(`head:${network.chainId}`, () =>
    withReadDeadline(getClient(network).publicClient.getBlockNumber()),
  );
}

/**
 * The full directory for one chain, newest first.
 *
 * Reads the store (no RPC) plus one cached `eth_blockNumber` to classify
 * status. Live state is fetched separately, only for the rows actually shown.
 */
export async function getDirectory(network: NetworkDefaults): Promise<DirectoryData> {
  const snapshot = await readStore(network);

  if (!snapshot || snapshot.auctions.length === 0) {
    return {
      network,
      entries: [],
      headBlock: 0n,
      counts: { all: 0, live: 0, pending: 0, ended: 0, graduated: 0 },
      empty: true,
      lastSyncedBlock: 0n,
      isStale: false,
    };
  }

  let headBlock = snapshot.lastSyncedBlock;
  let isStale = false;
  try {
    headBlock = await headBlockOf(network);
  } catch {
    isStale = true;
  }

  const entries = snapshot.auctions
    .map((record) => toEntry(record, headBlock))
    .filter((entry): entry is DirectoryEntry => entry !== null)
    .reverse();

  return {
    network,
    entries,
    headBlock,
    counts: {
      all: entries.length,
      live: entries.filter((e) => e.status === "live").length,
      pending: entries.filter((e) => e.status === "pending").length,
      ended: entries.filter((e) => e.status === "ended").length,
      // Graduation is live state, filled in by the caller for visible rows only.
      graduated: 0,
    },
    empty: false,
    lastSyncedBlock: snapshot.lastSyncedBlock,
    isStale,
  };
}

/** Auction and live counts per listed chain, for the chain switcher. Store reads only. */
export async function getNetworkCounts(): Promise<
  Array<{ network: NetworkDefaults; all: number; live: number }>
> {
  return Promise.all(
    listedNetworks().map(async (network) => {
      const snapshot = await readStore(network).catch(() => undefined);
      const records = snapshot?.auctions ?? [];
      // Classify against the store's own watermark - no RPC for the switcher.
      const head = snapshot?.lastSyncedBlock ?? 0n;
      const live = records.filter((r) => r.info && deriveStatus(r.info, head) === "live").length;
      return { network, all: records.length, live };
    }),
  );
}

/**
 * Cheap live state for a page of auctions, in a single multicall.
 * Used for list rows; the detail page uses the lens instead.
 */
export async function getListStates(
  network: NetworkDefaults,
  auctions: readonly Address[],
): Promise<Map<Address, AuctionListState>> {
  if (auctions.length === 0) return new Map();
  try {
    const key = `list:${network.chainId}:${auctions.map((a) => a.toLowerCase()).join(",")}`;
    return await cachedRead(key, () =>
      withReadDeadline(getAuctionListStates(getClient(network), auctions)),
    );
  } catch {
    // A directory that renders without live numbers beats a 500.
    return new Map();
  }
}

// --- one auction ------------------------------------------------------------------

/**
 * Which listed chain an auction is on, from the committed stores. Lets old
 * links without `?chain=` keep working.
 */
export async function findAuctionNetwork(address: Address): Promise<NetworkDefaults | undefined> {
  for (const network of listedNetworks()) {
    const snapshot = await readStore(network).catch(() => undefined);
    if (snapshot?.auctions.some((r) => r.auction.toLowerCase() === address.toLowerCase())) {
      return network;
    }
  }
  return undefined;
}

export interface AuctionDetail {
  network: NetworkDefaults;
  entry: DirectoryEntry;
  summary: Awaited<ReturnType<typeof getAuctionSummary>> | null;
}

/** Full detail for one auction, using the lens for the freshest state. */
export async function getAuctionDetail(
  network: NetworkDefaults,
  address: Address,
): Promise<AuctionDetail | null> {
  const snapshot = await readStore(network);
  const record = snapshot?.auctions.find(
    (candidate) => candidate.auction.toLowerCase() === address.toLowerCase(),
  );

  try {
    const client = getClient(network);
    const headBlock = await headBlockOf(network);

    // Fall back to reading config straight from the chain for an auction the
    // store has not seen yet - a brand new one, or an address typed by hand.
    const summary = await cachedRead(`summary:${network.chainId}:${address.toLowerCase()}`, () =>
      withReadDeadline(getAuctionSummary(client, address, { info: record?.info, blockNumber: headBlock })),
    );

    const { getTokenMetadata } = await import("@hammerock/cca-sdk");
    const [token, currency] = await Promise.all([
      record?.tokenMeta ?? getTokenMetadata(client, summary.info.token),
      record?.currencyMeta ?? getTokenMetadata(client, summary.info.currency),
    ]);

    return {
      network,
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
  } catch (error) {
    const entry = record && snapshot ? toEntry(record, snapshot.lastSyncedBlock) : null;
    if (entry) return { network, entry, summary: null };
    throw error;
  }
}

/** Live state for the detail page's polling endpoint. */
export async function getLiveState(network: NetworkDefaults, address: Address) {
  return cachedRead(`live:${network.chainId}:${address.toLowerCase()}`, async () => {
    const client = getClient(network);
    const [state, headBlock] = await withReadDeadline(
      Promise.all([getAuctionState(client, address), client.publicClient.getBlockNumber()]),
    );
    return { state, headBlock };
  });
}

export function explorerUrl(network: NetworkDefaults, path: string): string {
  const base = getClient(network).chain.blockExplorers?.default?.url ?? `https://${network.blockscout}`;
  return `${base}${path}`;
}
