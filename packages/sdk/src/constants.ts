/**
 * Deployment addresses and chain configuration.
 *
 * Mainnets are supported for READING. Anything that spends money is gated
 * separately by the surface that does it: the bidding agent refuses a mainnet
 * broadcast without an explicit opt-in, and the widget only ever asks the
 * visitor's own wallet to sign. See {@link isTestnet}.
 */
import { arbitrum, base, baseSepolia, mainnet, sepolia, unichain, unichainSepolia } from "viem/chains";
import type { Address } from "viem";

export type FactoryVersion = "v1.1.0" | "v2.0.0" | "v2.1.0";

export interface FactoryDeployment {
  version: FactoryVersion;
  address: Address;
  /**
   * Where discovery starts scanning on each chain this version is deployed to:
   * the factory's creation block from Blockscout, or - where the explorer has no
   * creation record (Arbitrum v1.1.0 and v2.0.0) - the block of its first
   * `AuctionCreated` log, which is equally safe since nothing precedes it.
   */
  startBlock: Partial<Record<number, bigint>>;
}

/**
 * Every `ContinuousClearingAuctionFactory` version, newest first.
 *
 * Each is a CREATE2 singleton at the same address on every chain it is on.
 * Uniswap's deployments page says versions before v2.0.0 "should no longer be
 * used or integrated with" - but auctions v1.1.0 already created still exist and
 * still settle, so discovery keeps reading them. All three emit the same
 * `AuctionCreated` event, and every auction function Beacon calls has the same
 * signature in all three (diffed between upstream tags v1.1.0 and v2.1.0, and
 * read live from v2.1.0 auctions on Sepolia).
 */
export const FACTORIES: readonly FactoryDeployment[] = [
  {
    version: "v2.1.0",
    address: "0x000000001F26a0044BaA66024e7b6599c61963F8",
    startBlock: {
      [mainnet.id]: 25503447n,
      [base.id]: 48456182n,
      [unichain.id]: 52953409n,
      [arbitrum.id]: 482127680n,
      [sepolia.id]: 11244482n,
      [baseSepolia.id]: 43966853n,
      [unichainSepolia.id]: 56849612n,
    },
  },
  {
    version: "v2.0.0",
    address: "0x00cCa200BF124dBfA848937c553864f4B4CE0632",
    startBlock: {
      [mainnet.id]: 25331230n,
      [base.id]: 47420514n,
      [unichain.id]: 50882062n,
      [arbitrum.id]: 476901523n,
      [sepolia.id]: 11074160n,
      [baseSepolia.id]: 42932946n,
    },
  },
  {
    version: "v1.1.0",
    address: "0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5",
    startBlock: {
      [mainnet.id]: 24321671n,
      [base.id]: 41336767n,
      [unichain.id]: 38733234n,
      [arbitrum.id]: 428349098n,
      [sepolia.id]: 10130119n,
      [baseSepolia.id]: 36881822n,
      [unichainSepolia.id]: 42808833n,
    },
  },
];

/** The current factory - the one new auctions are created with. */
export const FACTORY_ADDRESS: Address = FACTORIES[0]!.address;

/**
 * The deprecated v1.1.0 factory. Only Beacon's demo-auction script uses it,
 * because `initializeDistribution` was removed from the v2 factory.
 */
export const LEGACY_V1_FACTORY_ADDRESS: Address = "0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5";

/** Factory versions deployed on a chain, newest first. */
export function factoriesOnChain(chainId: number): FactoryDeployment[] {
  return FACTORIES.filter((f) => f.startBlock[chainId] !== undefined);
}

/** Which factory version created an auction, from the log's emitting address. */
export function factoryVersionOf(factory: Address): FactoryVersion | undefined {
  return FACTORIES.find((f) => f.address.toLowerCase() === factory.toLowerCase())?.version;
}

/**
 * Block discovery starts scanning on each chain: the earliest of every factory
 * version deployed there. Scanning from 0 instead wastes thousands of calls.
 */
export const FACTORY_DEPLOY_BLOCK: Record<number, bigint> = Object.fromEntries(
  [...new Set(FACTORIES.flatMap((f) => Object.keys(f.startBlock).map(Number)))].map((chainId) => [
    chainId,
    factoriesOnChain(chainId)
      .map((f) => f.startBlock[chainId]!)
      .reduce((a, b) => (a < b ? a : b)),
  ]),
);

/** Testnets. Nothing on these is worth real money. */
export const TESTNET_CHAINS = {
  [sepolia.id]: sepolia,
  [baseSepolia.id]: baseSepolia,
  [unichainSepolia.id]: unichainSepolia,
} as const;

/** Mainnets with CCA deployments. Real money - see {@link isTestnet}. */
export const MAINNET_CHAINS = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [unichain.id]: unichain,
  [arbitrum.id]: arbitrum,
} as const;

/** Every chain Beacon can read. */
export const SUPPORTED_CHAINS = { ...MAINNET_CHAINS, ...TESTNET_CHAINS } as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

/** True only for a known testnet. An unknown chain is NOT a testnet. */
export function isTestnet(chainId: number): boolean {
  return chainId in TESTNET_CHAINS;
}

/**
 * Approximate seconds per block, used to turn a block countdown into a human
 * "time remaining". Estimates - block times drift.
 */
export const BLOCK_TIME_SECONDS: Record<number, number> = {
  [mainnet.id]: 12,
  [base.id]: 2,
  [unichain.id]: 1,
  [arbitrum.id]: 0.25,
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

/**
 * Canonical Permit2, deployed at the same address on every chain.
 *
 * ERC-20 bids do NOT approve the auction. `ContinuousClearingAuction.submitBid`
 * pulls the bid currency with `SafeTransferLib.permit2TransferFrom`, which
 * calls Permit2's `transferFrom(from,to,uint160,token)`. A bidder therefore
 * needs an ERC-20 approval to THIS address, plus a Permit2 allowance naming the
 * auction as spender. Matches solady's `SafeTransferLib.PERMIT2`.
 */
export const PERMIT2_ADDRESS: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
