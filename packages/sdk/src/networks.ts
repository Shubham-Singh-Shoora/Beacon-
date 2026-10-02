/**
 * Per-chain defaults: a free RPC that works, how wide an `eth_getLogs` it
 * accepts, whether it serves old blocks, and the Blockscout instance used to
 * backfill history when it does not.
 *
 * Every limit below was measured against the live endpoint (2026-10-03), not
 * taken from docs. Free endpoints change their limits without notice - set
 * `BEACON_RPC_URL_<chainId>` / `BEACON_FALLBACK_RPC_URL_<chainId>` to override.
 */
import { arbitrum, base, baseSepolia, mainnet, sepolia, unichain, unichainSepolia } from "viem/chains";

export interface NetworkDefaults {
  chainId: number;
  /** URL-safe name, used in routes and store file names. */
  slug: string;
  name: string;
  testnet: boolean;
  /** A free, keyless endpoint for reads and recent logs. */
  rpcUrl: string;
  /** Widest `eth_getLogs` range (blocks) the free endpoint accepts. */
  logChunkSize: bigint;
  /**
   * Whether the free endpoint serves `eth_getLogs` for OLD blocks. When false,
   * discovery backfills history from Blockscout and uses the RPC only for
   * recent blocks.
   */
  historicalLogs: boolean;
  /** Blockscout host for history backfill. */
  blockscout: string;
  /** Rough blocks per hour, for overlap windows and time estimates. */
  blocksPerHour: number;
}

export const NETWORKS: Readonly<Record<number, NetworkDefaults>> = {
  [mainnet.id]: {
    chainId: mainnet.id,
    slug: "ethereum",
    name: "Ethereum",
    testnet: false,
    // Serves the last ~24h of logs; older blocks need a key ("archive").
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    logChunkSize: 5_000n,
    historicalLogs: false,
    blockscout: "eth.blockscout.com",
    blocksPerHour: 300,
  },
  [base.id]: {
    chainId: base.id,
    slug: "base",
    name: "Base",
    testnet: false,
    rpcUrl: "https://mainnet.base.org",
    logChunkSize: 2_000n,
    historicalLogs: true,
    blockscout: "base.blockscout.com",
    blocksPerHour: 1_800,
  },
  [unichain.id]: {
    chainId: unichain.id,
    slug: "unichain",
    name: "Unichain",
    testnet: false,
    rpcUrl: "https://mainnet.unichain.org",
    logChunkSize: 10_000n,
    historicalLogs: true,
    blockscout: "unichain.blockscout.com",
    blocksPerHour: 3_600,
  },
  [arbitrum.id]: {
    chainId: arbitrum.id,
    slug: "arbitrum",
    name: "Arbitrum One",
    testnet: false,
    // Accepted a 5,000,000-block range in testing.
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    logChunkSize: 1_000_000n,
    historicalLogs: true,
    blockscout: "arbitrum.blockscout.com",
    blocksPerHour: 14_400,
  },
  [sepolia.id]: {
    chainId: sepolia.id,
    slug: "sepolia",
    name: "Sepolia",
    testnet: true,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    logChunkSize: 50_000n,
    historicalLogs: true,
    blockscout: "eth-sepolia.blockscout.com",
    blocksPerHour: 300,
  },
  [baseSepolia.id]: {
    chainId: baseSepolia.id,
    slug: "base-sepolia",
    name: "Base Sepolia",
    testnet: true,
    // 1,000-block cap: fine for recent blocks, far too slow for history.
    rpcUrl: "https://sepolia.base.org",
    logChunkSize: 1_000n,
    historicalLogs: false,
    blockscout: "base-sepolia.blockscout.com",
    blocksPerHour: 1_800,
  },
  [unichainSepolia.id]: {
    chainId: unichainSepolia.id,
    slug: "unichain-sepolia",
    name: "Unichain Sepolia",
    testnet: true,
    rpcUrl: "https://sepolia.unichain.org",
    logChunkSize: 10_000n,
    historicalLogs: true,
    blockscout: "unichain-sepolia.blockscout.com",
    blocksPerHour: 3_600,
  },
};

export function networkFor(chainId: number): NetworkDefaults | undefined {
  return NETWORKS[chainId];
}

export function networkBySlug(slug: string): NetworkDefaults | undefined {
  return Object.values(NETWORKS).find((n) => n.slug === slug.toLowerCase());
}

/** RPC settings for one chain, resolved from environment variables. */
export interface RpcSettings {
  rpcUrl: string;
  fallbackRpcUrls: string[];
  logsRpcUrl?: string;
}

/**
 * Resolve RPC settings for a chain from env vars, falling back to the free
 * default. Per-chain variables win; the unsuffixed ones apply only to the chain
 * named by `BEACON_CHAIN_ID`, so a single-chain `.env` keeps working.
 *
 *   BEACON_RPC_URL_<id>            primary
 *   BEACON_FALLBACK_RPC_URL_<id>   tried when the primary errors (comma-separated)
 *   BEACON_LOGS_RPC_URL_<id>       eth_getLogs only
 */
export function rpcSettingsFromEnv(
  chainId: number,
  env: Record<string, string | undefined> = process.env,
): RpcSettings {
  const pick = (name: string) => {
    const specific = env[`${name}_${chainId}`]?.trim();
    if (specific) return specific;
    const generic = env[name]?.trim();
    return generic && Number(env.BEACON_CHAIN_ID) === chainId ? generic : undefined;
  };
  const rpcUrl = pick("BEACON_RPC_URL") ?? networkFor(chainId)?.rpcUrl;
  if (!rpcUrl) throw new Error(`No RPC URL for chain ${chainId}: set BEACON_RPC_URL_${chainId}.`);
  return {
    rpcUrl,
    fallbackRpcUrls: (pick("BEACON_FALLBACK_RPC_URL") ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
    logsRpcUrl: pick("BEACON_LOGS_RPC_URL"),
  };
}
