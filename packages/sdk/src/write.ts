/**
 * The write path: building a `submitBid` transaction.
 *
 * Scope note. This module builds and encodes bids, and understands the two
 * things that make a CCA bid different from an ordinary transfer:
 *
 * 1. The bid currency is often an ERC-20, not native ETH, so a bid may need an
 *    `approve` first and must NOT send `value`.
 * 2. `submitBid` has two overloads. The five-argument form takes a
 *    `prevTickPrice` hint; the four-argument form finds the tick itself by
 *    walking from the floor price, which is correct but costs far more gas.
 *
 * Today this uses the no-hint overload, which is always safe. Phase 4 adds the
 * tick-hint lookup for the bidding agent, where gas actually matters.
 *
 * Nothing here broadcasts. These helpers return request objects for a caller's
 * wallet client (the widget) or wallet-bearing agent (Phase 4) to send, which
 * keeps signing concerns out of the SDK.
 */
import { encodeFunctionData, maxUint256 } from "viem";
import type { Address, Hex } from "viem";
import { auctionAbi } from "./abis";
import type { BeaconClient } from "./client";
import { NATIVE_CURRENCY } from "./constants";
import { erc20MetadataAbi } from "./erc20";

/** Minimal ERC-20 approval surface, needed when the bid currency is a token. */
export const erc20ApprovalAbi = [
  ...erc20MetadataAbi,
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export interface SubmitBidParams {
  auction: Address;
  /** Highest price the bidder will pay, Q96-encoded. Use `decimalToQ96`. */
  maxPriceQ96: bigint;
  /** Bid size, in the currency's smallest unit. uint128 on-chain. */
  amount: bigint;
  /** Who owns the resulting bid. Usually the connected wallet. */
  owner: Address;
  /** Extra data for a validation hook, if the auction has one. */
  hookData?: Hex;
  /** True when the auction's currency is native ETH, so `value` must be sent. */
  isNativeCurrency: boolean;
}

export interface TransactionRequest {
  to: Address;
  data: Hex;
  value: bigint;
}

const UINT128_MAX = 2n ** 128n - 1n;

/**
 * Encode a `submitBid` call.
 *
 * @throws RangeError if `amount` does not fit the contract's `uint128`.
 */
export function encodeSubmitBid(params: SubmitBidParams): TransactionRequest {
  if (params.amount <= 0n) {
    throw new RangeError(`submitBid: amount must be positive, got ${params.amount}`);
  }
  if (params.amount > UINT128_MAX) {
    throw new RangeError(`submitBid: amount ${params.amount} exceeds uint128.`);
  }
  if (params.maxPriceQ96 <= 0n) {
    throw new RangeError(`submitBid: maxPriceQ96 must be positive, got ${params.maxPriceQ96}`);
  }

  const data = encodeFunctionData({
    abi: auctionAbi,
    functionName: "submitBid",
    // Four arguments selects the no-hint overload.
    args: [params.maxPriceQ96, params.amount, params.owner, params.hookData ?? "0x"],
  });

  return {
    to: params.auction,
    data,
    // ERC-20 bids are pulled via transferFrom; sending value would strand ETH.
    value: params.isNativeCurrency ? params.amount : 0n,
  };
}

/** Encode an ERC-20 `approve` for the auction to pull the bid currency. */
export function encodeApprove(
  currency: Address,
  auction: Address,
  amount: bigint = maxUint256,
): TransactionRequest {
  return {
    to: currency,
    data: encodeFunctionData({
      abi: erc20ApprovalAbi,
      functionName: "approve",
      args: [auction, amount],
    }),
    value: 0n,
  };
}

export interface BidReadiness {
  /** Whether the bidder holds enough of the currency. */
  hasBalance: boolean;
  balance: bigint;
  /** Whether the auction is already approved to pull `amount`. */
  hasAllowance: boolean;
  allowance: bigint;
  /** True when an `approve` must be sent before the bid. */
  needsApproval: boolean;
}

/**
 * Check whether a bidder can actually submit a given bid right now.
 *
 * For native-currency auctions there is nothing to approve, so allowance is
 * reported as unlimited.
 */
export async function checkBidReadiness(
  client: BeaconClient,
  params: {
    auction: Address;
    currency: Address;
    bidder: Address;
    amount: bigint;
  },
): Promise<BidReadiness> {
  if (params.currency === NATIVE_CURRENCY) {
    const balance = await client.publicClient.getBalance({ address: params.bidder });
    return {
      hasBalance: balance >= params.amount,
      balance,
      hasAllowance: true,
      allowance: maxUint256,
      needsApproval: false,
    };
  }

  const [balance, allowance] = await client.publicClient.multicall({
    allowFailure: false,
    contracts: [
      {
        address: params.currency,
        abi: erc20ApprovalAbi,
        functionName: "balanceOf",
        args: [params.bidder],
      },
      {
        address: params.currency,
        abi: erc20ApprovalAbi,
        functionName: "allowance",
        args: [params.bidder, params.auction],
      },
    ],
  });

  return {
    hasBalance: balance >= params.amount,
    balance,
    hasAllowance: allowance >= params.amount,
    allowance,
    needsApproval: allowance < params.amount,
  };
}

/**
 * Why a bid cannot be submitted, or `null` when it can.
 * Callers use this to disable a bid button with an honest reason.
 */
export function describeBidBlocker(input: {
  status: "pending" | "live" | "ended";
  amount: bigint;
  maxPriceQ96: bigint;
  floorPriceQ96: bigint;
  readiness?: BidReadiness;
}): string | null {
  if (input.status === "ended") return "This auction has ended - bidding is closed.";
  if (input.status === "pending") return "This auction has not opened yet.";
  if (input.amount <= 0n) return "Enter a bid amount.";
  if (input.maxPriceQ96 <= 0n) return "Enter a maximum price.";
  if (input.maxPriceQ96 < input.floorPriceQ96) {
    return "Your maximum price is below the auction's floor price.";
  }
  if (input.readiness && !input.readiness.hasBalance) return "Insufficient balance.";
  return null;
}
