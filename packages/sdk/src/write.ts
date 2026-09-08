/**
 * The write path: building a `submitBid` transaction.
 *
 * Three things here are easy to get wrong, and all three are verified against
 * the v1.1.0 contract source rather than assumed:
 *
 * 1. ERC-20 bids go through PERMIT2, not a plain `transferFrom`.
 *    `ContinuousClearingAuction.submitBid` calls
 *    `SafeTransferLib.permit2TransferFrom(...)` unconditionally for a
 *    non-native currency, which invokes Permit2's
 *    `transferFrom(from,to,uint160,token)`. Approving the AUCTION directly does
 *    nothing - the auction never calls `token.transferFrom`. A bidder needs
 *    BOTH an ERC-20 approval to Permit2 AND a Permit2 allowance for the
 *    auction as spender.
 *
 * 2. Native bids must send `msg.value == amount` exactly, and must send zero
 *    value for ERC-20 currencies (`if (msg.value != 0) revert
 *    CurrencyIsNotNative()`).
 *
 * 3. `prevTickPrice` is a search hint, not a price the bidder pays. The
 *    four-argument overload is literally
 *    `submitBid(maxPrice, amount, owner, FLOOR_PRICE, hookData)` - always
 *    correct, but it walks every tick from the floor.
 *
 * Nothing here broadcasts. These helpers return request objects for a caller's
 * wallet client to send, which keeps signing concerns out of the SDK.
 */
import { encodeFunctionData, maxUint256 } from "viem";
import type { Address, Hex } from "viem";
import { auctionAbi } from "./abis";
import type { BeaconClient } from "./client";
import { NATIVE_CURRENCY, PERMIT2_ADDRESS } from "./constants";
import { erc20MetadataAbi } from "./erc20";

/** ERC-20 approval + balance surface. */
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

/** Permit2 AllowanceTransfer, the second half of the ERC-20 approval flow. */
export const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const UINT128_MAX = 2n ** 128n - 1n;
const UINT160_MAX = 2n ** 160n - 1n;
const UINT48_MAX = 2n ** 48n - 1n;

export interface TransactionRequest {
  to: Address;
  data: Hex;
  value: bigint;
}

/**
 * Round a price DOWN to the nearest tick boundary.
 *
 * `submitBid` reverts with `TickPriceNotAtBoundary()` unless `maxPrice` is an
 * exact multiple of the auction's `tickSpacing` - the same rule the constructor
 * applies to the floor price, but it also applies to every bid. A price typed
 * by a human almost never lands on a boundary, so it has to be snapped.
 *
 * Rounding DOWN is the only safe direction: it can only lower the ceiling a
 * bidder is committing to, never raise it above what they asked for.
 */
export function alignPriceToTickBoundary(priceQ96: bigint, tickSpacing: bigint): bigint {
  if (tickSpacing <= 0n) {
    throw new RangeError(`alignPriceToTickBoundary: tickSpacing must be positive, got ${tickSpacing}`);
  }
  return (priceQ96 / tickSpacing) * tickSpacing;
}

/** True when a price sits exactly on a tick boundary. */
export function isPriceOnTickBoundary(priceQ96: bigint, tickSpacing: bigint): boolean {
  return tickSpacing > 0n && priceQ96 % tickSpacing === 0n;
}

export interface SubmitBidParams {
  auction: Address;
  /** Highest price the bidder will pay, Q96-encoded. Use `decimalToQ96`. */
  maxPriceQ96: bigint;
  /** Bid size, in the currency's smallest unit. uint128 on-chain. */
  amount: bigint;
  /** Who owns the resulting bid. */
  owner: Address;
  /** Extra data for a validation hook, if the auction has one. */
  hookData?: Hex;
  /** True when the auction's currency is native ETH, so `value` must be sent. */
  isNativeCurrency: boolean;
  /**
   * Search hint: the initialised tick at or below `maxPriceQ96`. Omit to use
   * the floor price, which is always correct but costs more gas.
   * See {@link getPrevTickHint}.
   */
  prevTickPriceQ96?: bigint;
  /**
   * The auction's tick spacing. When given, the price is checked against it so
   * a misaligned bid fails here with a clear message instead of on-chain with
   * an opaque `TickPriceNotAtBoundary()`.
   */
  tickSpacing?: bigint;
}

/**
 * Encode a `submitBid` call.
 *
 * @throws RangeError if the amount does not fit the contract's `uint128`.
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
  if (params.tickSpacing !== undefined && !isPriceOnTickBoundary(params.maxPriceQ96, params.tickSpacing)) {
    throw new RangeError(
      `submitBid: maxPriceQ96 ${params.maxPriceQ96} is not a multiple of tickSpacing ` +
        `${params.tickSpacing} and would revert with TickPriceNotAtBoundary(). ` +
        `Use alignPriceToTickBoundary() first.`,
    );
  }

  const data =
    params.prevTickPriceQ96 === undefined
      ? encodeFunctionData({
          abi: auctionAbi,
          functionName: "submitBid",
          // Four args selects the no-hint overload, which passes FLOOR_PRICE.
          args: [params.maxPriceQ96, params.amount, params.owner, params.hookData ?? "0x"],
        })
      : encodeFunctionData({
          abi: auctionAbi,
          functionName: "submitBid",
          args: [
            params.maxPriceQ96,
            params.amount,
            params.owner,
            params.prevTickPriceQ96,
            params.hookData ?? "0x",
          ],
        });

  return {
    to: params.auction,
    data,
    // ERC-20 bids are pulled via Permit2; any value sent would revert with
    // CurrencyIsNotNative().
    value: params.isNativeCurrency ? params.amount : 0n,
  };
}

/**
 * Look up a `prevTickPrice` hint.
 *
 * The auction inserts a bid by walking initialised ticks upward from this
 * price. `nextActiveTickPrice()` is the next initialised tick above the current
 * clearing price, so it is a strictly better starting point than the floor
 * whenever the bid sits above it. Anything at or above `maxPrice` would make
 * the contract search past the target, so those fall back to the floor.
 *
 * A wrong hint cannot make a bid execute at a different price - it only affects
 * how far the contract searches - but a hint above the target reverts, so this
 * is deliberately conservative.
 */
export async function getPrevTickHint(
  client: BeaconClient,
  auction: Address,
  maxPriceQ96: bigint,
): Promise<bigint> {
  const [floorPrice, nextActive] = await client.publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: auction, abi: auctionAbi, functionName: "floorPrice" },
      { address: auction, abi: auctionAbi, functionName: "nextActiveTickPrice" },
    ],
  });

  if (nextActive > floorPrice && nextActive < maxPriceQ96) return nextActive;
  return floorPrice;
}

/** Approve Permit2 to move the bid currency. Step 1 of 2 for ERC-20 bids. */
export function encodeApproveErc20ToPermit2(
  currency: Address,
  amount: bigint = maxUint256,
): TransactionRequest {
  return {
    to: currency,
    data: encodeFunctionData({
      abi: erc20ApprovalAbi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, amount],
    }),
    value: 0n,
  };
}

/**
 * Grant the auction a Permit2 allowance. Step 2 of 2 for ERC-20 bids.
 *
 * @param expiration Unix seconds. Defaults to 30 days out; Permit2 stores this
 *   as a uint48, and an expired allowance fails at transfer time.
 */
export function encodeApprovePermit2(
  currency: Address,
  auction: Address,
  amount: bigint = UINT160_MAX,
  expiration?: bigint,
): TransactionRequest {
  if (amount > UINT160_MAX) {
    throw new RangeError(`Permit2 approve: amount ${amount} exceeds uint160.`);
  }
  const expiry = expiration ?? BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
  if (expiry > UINT48_MAX) {
    throw new RangeError(`Permit2 approve: expiration ${expiry} exceeds uint48.`);
  }

  return {
    to: PERMIT2_ADDRESS,
    data: encodeFunctionData({
      abi: permit2Abi,
      functionName: "approve",
      args: [currency, auction, amount, Number(expiry)],
    }),
    value: 0n,
  };
}

export interface BidReadiness {
  /** Whether the bidder holds enough of the currency. */
  hasBalance: boolean;
  balance: bigint;
  /** ERC-20 allowance granted to Permit2. Unlimited for native currency. */
  erc20AllowanceToPermit2: bigint;
  /** Permit2 allowance granted to the auction. Unlimited for native currency. */
  permit2AllowanceToAuction: bigint;
  /** When the Permit2 allowance lapses, as unix seconds. */
  permit2Expiration: bigint;
  /** True when step 1 (ERC-20 -> Permit2) is still needed. */
  needsErc20Approval: boolean;
  /** True when step 2 (Permit2 -> auction) is still needed. */
  needsPermit2Approval: boolean;
  /** Convenience: either approval step is outstanding. */
  needsApproval: boolean;
}

/**
 * Check whether a bidder can actually submit a given bid right now.
 *
 * Native-currency auctions need no approvals at all, so those are reported as
 * unlimited rather than pretending an allowance was read.
 */
export async function checkBidReadiness(
  client: BeaconClient,
  params: { auction: Address; currency: Address; bidder: Address; amount: bigint },
): Promise<BidReadiness> {
  if (params.currency === NATIVE_CURRENCY) {
    const balance = await client.publicClient.getBalance({ address: params.bidder });
    return {
      hasBalance: balance >= params.amount,
      balance,
      erc20AllowanceToPermit2: maxUint256,
      permit2AllowanceToAuction: maxUint256,
      permit2Expiration: maxUint256,
      needsErc20Approval: false,
      needsPermit2Approval: false,
      needsApproval: false,
    };
  }

  const [balance, erc20Allowance, permit2Allowance] = await client.publicClient.multicall({
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
        args: [params.bidder, PERMIT2_ADDRESS],
      },
      {
        address: PERMIT2_ADDRESS,
        abi: permit2Abi,
        functionName: "allowance",
        args: [params.bidder, params.currency, params.auction],
      },
    ],
  });

  const [permit2Amount, permit2Expiration] = permit2Allowance as readonly [bigint, number, number];
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const permit2Expired = BigInt(permit2Expiration) <= nowSeconds;

  const needsErc20Approval = erc20Allowance < params.amount;
  const needsPermit2Approval = permit2Amount < params.amount || permit2Expired;

  return {
    hasBalance: balance >= params.amount,
    balance,
    erc20AllowanceToPermit2: erc20Allowance,
    permit2AllowanceToAuction: permit2Amount,
    permit2Expiration: BigInt(permit2Expiration),
    needsErc20Approval,
    needsPermit2Approval,
    needsApproval: needsErc20Approval || needsPermit2Approval,
  };
}

/**
 * Every transaction needed to place this bid, in order.
 * One entry for a native bid; up to three for an ERC-20 bid.
 */
export function buildBidTransactions(params: {
  auction: Address;
  currency: Address;
  maxPriceQ96: bigint;
  amount: bigint;
  owner: Address;
  readiness: BidReadiness;
  prevTickPriceQ96?: bigint;
  hookData?: Hex;
  /** When given, the price is snapped down to a boundary before encoding. */
  tickSpacing?: bigint;
}): Array<{ label: string; request: TransactionRequest }> {
  const isNative = params.currency === NATIVE_CURRENCY;
  const steps: Array<{ label: string; request: TransactionRequest }> = [];

  if (!isNative) {
    if (params.readiness.needsErc20Approval) {
      steps.push({
        label: "Approve Permit2 to move the bid currency",
        request: encodeApproveErc20ToPermit2(params.currency),
      });
    }
    if (params.readiness.needsPermit2Approval) {
      steps.push({
        label: "Grant the auction a Permit2 allowance",
        request: encodeApprovePermit2(params.currency, params.auction),
      });
    }
  }

  // A human-entered price almost never lands on a tick boundary, and the
  // contract rejects it outright. Snap down before encoding.
  const alignedPriceQ96 =
    params.tickSpacing === undefined
      ? params.maxPriceQ96
      : alignPriceToTickBoundary(params.maxPriceQ96, params.tickSpacing);

  steps.push({
    label: "Submit bid",
    request: encodeSubmitBid({
      auction: params.auction,
      maxPriceQ96: alignedPriceQ96,
      amount: params.amount,
      owner: params.owner,
      isNativeCurrency: isNative,
      prevTickPriceQ96: params.prevTickPriceQ96,
      hookData: params.hookData,
      tickSpacing: params.tickSpacing,
    }),
  });

  return steps;
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
  tickSpacing?: bigint;
  readiness?: BidReadiness;
}): string | null {
  if (input.status === "ended") return "This auction has ended - bidding is closed.";
  if (input.status === "pending") return "This auction has not opened yet.";
  if (input.amount <= 0n) return "Enter a bid amount.";
  if (input.maxPriceQ96 <= 0n) return "Enter a maximum price.";
  if (input.maxPriceQ96 < input.floorPriceQ96) {
    return "Your maximum price is below the auction's floor price.";
  }
  if (input.tickSpacing !== undefined) {
    const aligned = alignPriceToTickBoundary(input.maxPriceQ96, input.tickSpacing);
    if (aligned < input.floorPriceQ96) {
      return "Your maximum price rounds down below the auction's floor price.";
    }
  }
  if (input.readiness && !input.readiness.hasBalance) return "Insufficient balance.";
  return null;
}
