/**
 * Minimal ERC-20 metadata reads.
 *
 * CCA auctions are NOT always denominated in native ETH - the auctions live on
 * Sepolia today bid in an ERC-20. Anything that shows an amount to a human has
 * to show the real symbol and scale by the real decimals, so this lives in the
 * SDK and every surface (bot, widget, directory, agent) uses it.
 */
import { formatUnits } from "viem";
import type { Address } from "viem";
import type { BeaconClient } from "./client";
import { NATIVE_CURRENCY } from "./constants";

/** ERC-20 reads Beacon needs. Hand-written because it is the standard, not a CCA ABI. */
export const erc20MetadataAbi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

export interface TokenMetadata {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  /** True when this is the chain's native currency rather than an ERC-20. */
  isNative: boolean;
}

/**
 * Read a currency's symbol, name and decimals.
 *
 * `address(0)` is the CCA sentinel for native currency, and resolves to the
 * chain's own native currency rather than an on-chain call.
 *
 * Tolerant by design: a token that omits `symbol`/`name` (or returns bytes32
 * instead of string) still yields usable metadata rather than throwing, because
 * failing to render an alert is worse than rendering a shortened address.
 */
export async function getTokenMetadata(
  client: BeaconClient,
  address: Address,
): Promise<TokenMetadata> {
  if (address === NATIVE_CURRENCY) {
    const native = client.chain.nativeCurrency;
    return {
      address,
      symbol: native.symbol,
      name: native.name,
      decimals: native.decimals,
      isNative: true,
    };
  }

  const contract = { address, abi: erc20MetadataAbi } as const;
  const [symbol, name, decimals] = await client.publicClient.multicall({
    allowFailure: true,
    contracts: [
      { ...contract, functionName: "symbol" },
      { ...contract, functionName: "name" },
      { ...contract, functionName: "decimals" },
    ],
  });

  return {
    address,
    symbol: symbol.status === "success" ? symbol.result : shortAddress(address),
    name: name.status === "success" ? name.result : shortAddress(address),
    // 18 is the overwhelmingly common default; better than refusing to render.
    decimals: decimals.status === "success" ? Number(decimals.result) : 18,
    isNative: false,
  };
}

/** Read metadata for several currencies at once, de-duplicated by address. */
export async function getTokenMetadataBatch(
  client: BeaconClient,
  addresses: readonly Address[],
): Promise<Map<Address, TokenMetadata>> {
  const unique = [...new Set(addresses)];
  const entries = await Promise.all(
    unique.map(async (address) => [address, await getTokenMetadata(client, address)] as const),
  );
  return new Map(entries);
}

/**
 * Render a raw token amount with its symbol, e.g. `"1,000 BEACON"`.
 *
 * A nonzero amount is NEVER rendered as "0". Real CCA test auctions raise
 * amounts like 52 wei, and truncating those to "0 ETH" makes a live auction
 * look dead. When an amount is too small for `maxFractionDigits`, the output
 * widens to show four significant digits instead.
 *
 * @param maxFractionDigits Fractional digits to keep for ordinary amounts.
 */
export function formatTokenAmount(
  amount: bigint,
  token: Pick<TokenMetadata, "symbol" | "decimals">,
  maxFractionDigits = 4,
): string {
  if (amount === 0n) return `0 ${token.symbol}`;

  const negative = amount < 0n;
  const whole = formatUnits(negative ? -amount : amount, token.decimals);
  const [integerPart = "0", fractionalPart = ""] = whole.split(".");

  const grouped = BigInt(integerPart).toLocaleString("en-US");
  let trimmed = fractionalPart.slice(0, maxFractionDigits).replace(/0+$/, "");

  // Too small to show at the requested precision: widen rather than say "0".
  if (integerPart === "0" && trimmed.length === 0) {
    const firstSignificant = fractionalPart.search(/[1-9]/);
    if (firstSignificant !== -1) {
      trimmed = fractionalPart.slice(0, firstSignificant + 4).replace(/0+$/, "");
    }
  }

  const sign = negative ? "-" : "";
  return trimmed.length > 0
    ? `${sign}${grouped}.${trimmed} ${token.symbol}`
    : `${sign}${grouped} ${token.symbol}`;
}

function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
