/**
 * Beacon's client wrapper: a viem public client plus the addresses every read
 * needs, with a hard testnet guard.
 */
import { createPublicClient, http } from "viem";
import type { Address, Chain, PublicClient } from "viem";
import {
  BLOCK_TIME_SECONDS,
  FACTORY_ADDRESS,
  FACTORY_DEPLOY_BLOCK,
  SUPPORTED_CHAINS,
} from "./constants";

export interface BeaconClientConfig {
  /** JSON-RPC endpoint used for state reads (eth_call, multicall). */
  rpcUrl: string;
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
  /** Chain id. Must be a supported testnet - mainnet is rejected. */
  chainId: number;
  /** Override the factory address. Defaults to the cross-chain singleton. */
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
}

export interface BeaconClient {
  publicClient: PublicClient;
  /** Client used for `eth_getLogs`. Same as `publicClient` unless overridden. */
  logsClient: PublicClient;
  chain: Chain;
  chainId: number;
  factoryAddress: Address;
  lensAddress?: Address;
  factoryDeployBlock: bigint;
  /** Approximate seconds per block, for time-remaining estimates. */
  blockTimeSeconds: number;
}

/**
 * Throw unless `chainId` is a testnet Beacon supports.
 *
 * This is the choke point that keeps every Beacon surface off mainnet. The
 * bidding agent layers its own guard on top before it broadcasts anything.
 */
export function assertSupportedChain(chainId: number): Chain {
  const chain = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!chain) {
    const supported = Object.values(SUPPORTED_CHAINS)
      .map((c) => `${c.name} (${c.id})`)
      .join(", ");
    throw new Error(
      `Beacon is testnet-only and refuses to run against chain id ${chainId}. Supported: ${supported}.`,
    );
  }
  return chain;
}

/** Build a Beacon client. Throws immediately on a non-testnet chain id. */
export function createBeaconClient(config: BeaconClientConfig): BeaconClient {
  const chain = assertSupportedChain(config.chainId);

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
    // Batch eagerly: reads fan out across many auctions in the directory.
    batch: { multicall: true },
  }) as PublicClient;

  const logsClient =
    config.logsRpcUrl && config.logsRpcUrl !== config.rpcUrl
      ? (createPublicClient({ chain, transport: http(config.logsRpcUrl) }) as PublicClient)
      : publicClient;

  const factoryDeployBlock = config.factoryDeployBlock ?? FACTORY_DEPLOY_BLOCK[config.chainId];
  if (factoryDeployBlock === undefined) {
    throw new Error(
      `No known factory deploy block for chain id ${config.chainId}. ` +
        `Pass \`factoryDeployBlock\` explicitly so discovery knows where to start scanning.`,
    );
  }

  return {
    publicClient,
    logsClient,
    chain,
    chainId: config.chainId,
    factoryAddress: config.factoryAddress ?? FACTORY_ADDRESS,
    lensAddress: config.lensAddress,
    factoryDeployBlock,
    blockTimeSeconds: BLOCK_TIME_SECONDS[config.chainId] ?? 12,
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
