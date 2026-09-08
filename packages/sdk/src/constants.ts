/**
 * Deployment addresses and chain configuration.
 *
 * Beacon is testnet-only by design. Mainnet chain ids are deliberately absent
 * from {@link SUPPORTED_CHAINS} so that every surface - directory, widget, bot
 * and agent - fails closed rather than touching real funds.
 */
import { baseSepolia, sepolia, unichainSepolia } from "viem/chains";
import type { Address } from "viem";

/**
 * `ContinuousClearingAuctionFactory` v1.1.0.
 *
 * Deployed through the deterministic CREATE2 deployer (`0x4e59b448...`), so the
 * address is identical on every chain Uniswap has launched CCA on.
 *
 * VERIFIED on Sepolia: the deployed runtime bytecode is byte-for-byte identical
 * to a local `forge build` of upstream tag v1.1.0. Re-check with
 * `./contracts/sync-abis.sh` and a bytecode diff before trusting a new chain.
 */
export const FACTORY_ADDRESS: Address = "0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5";

/**
 * Block each chain's factory was created at - where auction discovery starts
 * scanning. Scanning from 0 instead wastes thousands of RPC calls.
 */
export const FACTORY_DEPLOY_BLOCK: Record<number, bigint> = {
  [sepolia.id]: 10130119n,
};

/**
 * Testnets Beacon is allowed to talk to.
 *
 * Only Sepolia is verified end-to-end today; the other two are listed because
 * the factory is a cross-chain singleton, but their deploy blocks are unknown
 * (discovery will need an explicit `fromBlock`).
 */
export const SUPPORTED_CHAINS = {
  [sepolia.id]: sepolia,
  [baseSepolia.id]: baseSepolia,
  [unichainSepolia.id]: unichainSepolia,
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

/**
 * Approximate seconds per block, used to turn a block countdown into a human
 * "time remaining". Estimates - block times drift.
 */
export const BLOCK_TIME_SECONDS: Record<number, number> = {
  [sepolia.id]: 12,
  [baseSepolia.id]: 2,
  [unichainSepolia.id]: 1,
};

/**
 * Maximum block span for a single `eth_getLogs` call.
 *
 * Public Sepolia RPCs reject anything wider with
 * `-32701: exceed maximum block range: 50000`, and some clients surface that as
 * an empty result rather than an error - which looks exactly like "no auctions
 * exist". Discovery always chunks.
 */
export const DEFAULT_LOG_CHUNK_SIZE = 50_000n;

/** `address(0)` - the currency sentinel meaning native ETH. */
export const NATIVE_CURRENCY: Address = "0x0000000000000000000000000000000000000000";
