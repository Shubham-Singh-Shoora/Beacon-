/**
 * Beacon's client wrapper: a viem public client plus the addresses every read
 * needs. Reads work on every supported chain, mainnets included; spending is
 * gated by the surface that does it (see `isTestnet`).
 */
import { createPublicClient, fallback, http } from "viem";
import type { Address, Chain, PublicClient, Transport } from "viem";
import {
  BLOCK_TIME_SECONDS,
  FACTORY_ADDRESS,
  FACTORY_DEPLOY_BLOCK,
  factoriesOnChain,
  DEFAULT_LOG_CHUNK_SIZE,
  SUPPORTED_CHAINS,
} from "./constants";
import { networkFor } from "./networks";
import type { NetworkDefaults } from "./networks";

export interface BeaconClientConfig {
  /**
   * JSON-RPC endpoint used for state reads (eth_call, multicall). Defaults to
   * the chain's free endpoint from `NETWORKS`.
   */
  rpcUrl?: string;
  /**
   * Endpoints tried, in order, when the primary errors - e.g. a keyed provider
   * behind a free one. Applies to reads and to log scanning.
   */
  fallbackRpcUrls?: string[];
  /**
   * Optional separate endpoint for `eth_getLogs`.
   *
   * State reads and log scanning have different provider requirements, and one
   * endpoint is often bad at one of them. Alchemy's free tier serves eth_call
   * beautifully but caps eth_getLogs at a 10-block range, which makes a
   * historical backfill impossible; public wide-range endpoints allow the range
   * but can silently return empty results. Defaults to `rpcUrl`.
   */
  logsRpcUrl?: string;
  /** Chain id. Must be one of {@link SUPPORTED_CHAINS}. */
  chainId: number;
  /**
   * Restrict discovery to this one factory. By default discovery covers every
   * factory version deployed on the chain (see `FACTORIES`).
   */
  factoryAddress?: Address;
  /**
   * Address of a deployed `AuctionStateLens`.
   *
   * Optional. When omitted, reads run the lens via an `eth_call` state
   * override instead, so no deployment is required. See `read.ts`.
   */
  lensAddress?: Address;
  /** Override the block the factory was deployed at. */
  factoryDeployBlock?: bigint;
  /** Override the widest eth_getLogs range per request. */
  logChunkSize?: bigint;
}

export interface BeaconClient {
  publicClient: PublicClient;
  /** Client used for `eth_getLogs`. Same as `publicClient` unless overridden. */
  logsClient: PublicClient;
  chain: Chain;
  chainId: number;
  /** The current factory on this chain (or the override). */
  factoryAddress: Address;
  /** Every factory discovery scans, newest version first. */
  factoryAddresses: Address[];
  lensAddress?: Address;
  /**
   * Block the factory was created at, where discovery starts scanning.
   * Undefined on a chain with no known value - reads and bids still work; only
   * discovery needs it (see {@link requireFactoryDeployBlock}).
   */
  factoryDeployBlock?: bigint;
  /** Approximate seconds per block, for time-remaining estimates. */
  blockTimeSeconds: number;
  /** Widest eth_getLogs range the configured endpoint accepts. */
  logChunkSize: bigint;
  /** Measured defaults for this chain (free RPC, log limits, Blockscout host). */
  network?: NetworkDefaults;
}

/**
 * Throw unless `chainId` is a chain Beacon supports.
 *
 * This no longer distinguishes mainnet from testnet - reading is safe on both.
 * Anything that sends a transaction must check `isTestnet` itself.
 */
export function assertSupportedChain(chainId: number): Chain {
  const chain = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!chain) {
    const supported = Object.values(SUPPORTED_CHAINS)
      .map((c) => `${c.name} (${c.id})`)
      .join(", ");
    throw new Error(
      `Beacon does not support chain id ${chainId}. Supported: ${supported}.`,
    );
  }
  return chain;
}

/**
 * The block discovery starts scanning from.
 *
 * Only discovery needs this, so a client for a chain with no known deploy block
 * is still fully usable for reads and bids; it fails here instead.
 */
export function requireFactoryDeployBlock(client: BeaconClient): bigint {
  if (client.factoryDeployBlock === undefined) {
    throw new Error(
      `No known factory deploy block for chain id ${client.chainId}. ` +
        `Pass \`factoryDeployBlock\` explicitly so discovery knows where to start scanning.`,
    );
  }
  return client.factoryDeployBlock;
}

/** One URL, or several tried in order when the first errors. */
function transportFor(urls: string[]): Transport {
  return urls.length === 1 ? http(urls[0]) : fallback(urls.map((url) => http(url)));
}

/** Build a Beacon client. Throws immediately on an unsupported chain id. */
export function createBeaconClient(config: BeaconClientConfig): BeaconClient {
  const chain = assertSupportedChain(config.chainId);
  const network = networkFor(config.chainId);

  const rpcUrl = config.rpcUrl ?? network?.rpcUrl;
  if (!rpcUrl) throw new Error(`No RPC URL for chain ${config.chainId}; pass rpcUrl.`);
  const fallbacks = (config.fallbackRpcUrls ?? []).filter((u) => u && u !== rpcUrl);

  const publicClient = createPublicClient({
    chain,
    transport: transportFor([rpcUrl, ...fallbacks]),
    // Batch eagerly: reads fan out across many auctions in the directory.
    batch: { multicall: true },
  }) as PublicClient;

  const logsClient =
    config.logsRpcUrl && config.logsRpcUrl !== rpcUrl
      ? (createPublicClient({ chain, transport: transportFor([config.logsRpcUrl, ...fallbacks]) }) as PublicClient)
      : publicClient;

  const factoryDeployBlock = config.factoryDeployBlock ?? FACTORY_DEPLOY_BLOCK[config.chainId];

  return {
    publicClient,
    logsClient,
    chain,
    chainId: config.chainId,
    factoryAddress: config.factoryAddress ?? factoriesOnChain(config.chainId)[0]?.address ?? FACTORY_ADDRESS,
    factoryAddresses: config.factoryAddress
      ? [config.factoryAddress]
      : factoriesOnChain(config.chainId).map((f) => f.address),
    lensAddress: config.lensAddress,
    factoryDeployBlock,
    blockTimeSeconds: BLOCK_TIME_SECONDS[config.chainId] ?? 12,
    // A custom endpoint's limits are unknown; the measured default applies to
    // the free one. Discovery halves on rejection either way.
    logChunkSize: config.logChunkSize ?? network?.logChunkSize ?? DEFAULT_LOG_CHUNK_SIZE,
    network,
  };
}

/**
 * Confirm the RPC is actually serving the chain we were configured for.
 *
 * Cheap insurance against a copy-pasted RPC URL silently pointing at the wrong
 * network - which otherwise shows up as "no auctions found".
 */
export async function assertChainMatches(client: BeaconClient): Promise<void> {
  const actual = await client.publicClient.getChainId();
  if (actual !== client.chainId) {
    throw new Error(
      `RPC chain id mismatch: configured for ${client.chainId} (${client.chain.name}) ` +
        `but the endpoint reports ${actual}. Check BEACON_RPC_URL.`,
    );
  }
}
