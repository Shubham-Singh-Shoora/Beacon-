import { decodeFunctionData, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { auctionAbi } from "../src/abis";
import { NATIVE_CURRENCY, PERMIT2_ADDRESS } from "../src/constants";
import { decimalToQ96 } from "../src/q96";
import {
  buildBidTransactions,
  describeBidBlocker,
  encodeApproveErc20ToPermit2,
  encodeApprovePermit2,
  encodeSubmitBid,
  permit2Abi,
} from "../src/write";
import type { BidReadiness } from "../src/write";

const AUCTION = "0x145A9163d5a89fe843955b1D337F75d46088E156" as const;
const BIDDER = "0xa26DBABBbF9451F150A87d7635f6891474c4F0FA" as const;
const ERC20 = "0x59eB743864BA3008d3A89aFb2b66029269C66088" as const;

const PRICE = decimalToQ96("0.0001");
const AMOUNT = 10n ** 15n;

const readiness = (overrides: Partial<BidReadiness> = {}): BidReadiness => ({
  hasBalance: true,
  balance: 10n ** 18n,
  erc20AllowanceToPermit2: 0n,
  permit2AllowanceToAuction: 0n,
  permit2Expiration: 0n,
  needsErc20Approval: true,
  needsPermit2Approval: true,
  needsApproval: true,
  ...overrides,
});

describe("encodeSubmitBid", () => {
  it("selects the no-hint overload when no tick hint is given", () => {
    const request = encodeSubmitBid({
      auction: AUCTION,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      isNativeCurrency: true,
    });

    // The 4-arg overload; on-chain it forwards FLOOR_PRICE as prevTickPrice.
    expect(request.data.slice(0, 10)).toBe(
      toFunctionSelector("submitBid(uint256,uint128,address,bytes)"),
    );

    const decoded = decodeFunctionData({ abi: auctionAbi, data: request.data });
    expect(decoded.functionName).toBe("submitBid");
    expect(decoded.args).toEqual([PRICE, AMOUNT, BIDDER, "0x"]);
  });

  it("selects the hint overload when a tick hint is given", () => {
    const request = encodeSubmitBid({
      auction: AUCTION,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      isNativeCurrency: true,
      prevTickPriceQ96: 12345n,
    });

    expect(request.data.slice(0, 10)).toBe(
      toFunctionSelector("submitBid(uint256,uint128,address,uint256,bytes)"),
    );
    expect(decodeFunctionData({ abi: auctionAbi, data: request.data }).args).toEqual([
      PRICE,
      AMOUNT,
      BIDDER,
      12345n,
      "0x",
    ]);
  });

  it("sends msg.value equal to the amount for a native auction", () => {
    // submitBid reverts with InvalidAmount() unless msg.value == amount.
    const request = encodeSubmitBid({
      auction: AUCTION,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      isNativeCurrency: true,
    });
    expect(request.value).toBe(AMOUNT);
    expect(request.to).toBe(AUCTION);
  });

  it("sends ZERO value for an ERC-20 auction", () => {
    // submitBid reverts with CurrencyIsNotNative() if any value is attached.
    const request = encodeSubmitBid({
      auction: AUCTION,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      isNativeCurrency: false,
    });
    expect(request.value).toBe(0n);
  });

  it("rejects amounts and prices the contract could not accept", () => {
    const base = {
      auction: AUCTION,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      isNativeCurrency: true,
    };
    expect(() => encodeSubmitBid({ ...base, amount: 0n })).toThrow(RangeError);
    expect(() => encodeSubmitBid({ ...base, amount: -1n })).toThrow(RangeError);
    expect(() => encodeSubmitBid({ ...base, amount: 2n ** 128n })).toThrow(RangeError);
    expect(() => encodeSubmitBid({ ...base, maxPriceQ96: 0n })).toThrow(RangeError);
  });
});

describe("ERC-20 approvals go through Permit2", () => {
  it("approves Permit2 on the token, not the auction", () => {
    // The auction never calls token.transferFrom, so approving it does nothing.
    const request = encodeApproveErc20ToPermit2(ERC20);
    expect(request.to).toBe(ERC20);

    const decoded = decodeFunctionData({
      abi: [
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
      ] as const,
      data: request.data,
    });
    expect(decoded.args[0]).toBe(PERMIT2_ADDRESS);
    expect(decoded.args[0]).not.toBe(AUCTION);
  });

  it("grants the auction a Permit2 allowance with a future expiry", () => {
    const request = encodeApprovePermit2(ERC20, AUCTION);
    expect(request.to).toBe(PERMIT2_ADDRESS);

    const decoded = decodeFunctionData({ abi: permit2Abi, data: request.data });
    expect(decoded.functionName).toBe("approve");
    const [token, spender, , expiration] = decoded.args as readonly [
      string,
      string,
      bigint,
      number,
    ];
    expect(token).toBe(ERC20);
    expect(spender).toBe(AUCTION);
    expect(expiration).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects an allowance that would not fit Permit2's uint160", () => {
    expect(() => encodeApprovePermit2(ERC20, AUCTION, 2n ** 160n)).toThrow(RangeError);
  });
});

describe("buildBidTransactions", () => {
  it("is a single transaction for a native auction", () => {
    const steps = buildBidTransactions({
      auction: AUCTION,
      currency: NATIVE_CURRENCY,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      readiness: readiness({ needsErc20Approval: false, needsPermit2Approval: false }),
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]!.label).toBe("Submit bid");
    expect(steps[0]!.request.value).toBe(AMOUNT);
  });

  it("is approve -> permit2 approve -> bid for a fresh ERC-20 bidder", () => {
    const steps = buildBidTransactions({
      auction: AUCTION,
      currency: ERC20,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      readiness: readiness(),
    });

    expect(steps.map((s) => s.request.to)).toEqual([ERC20, PERMIT2_ADDRESS, AUCTION]);
    expect(steps.every((s) => s.request.value === 0n)).toBe(true);
  });

  it("skips approvals that are already in place", () => {
    const steps = buildBidTransactions({
      auction: AUCTION,
      currency: ERC20,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      readiness: readiness({ needsErc20Approval: false, needsPermit2Approval: false }),
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]!.request.to).toBe(AUCTION);
  });

  it("still needs the Permit2 step when only that allowance lapsed", () => {
    const steps = buildBidTransactions({
      auction: AUCTION,
      currency: ERC20,
      maxPriceQ96: PRICE,
      amount: AMOUNT,
      owner: BIDDER,
      readiness: readiness({ needsErc20Approval: false, needsPermit2Approval: true }),
    });

    expect(steps.map((s) => s.request.to)).toEqual([PERMIT2_ADDRESS, AUCTION]);
  });
});

describe("describeBidBlocker", () => {
  const base = {
    status: "live" as const,
    amount: AMOUNT,
    maxPriceQ96: PRICE,
    floorPriceQ96: decimalToQ96("0.00001"),
  };

  it("allows a well-formed live bid", () => {
    expect(describeBidBlocker(base)).toBeNull();
  });

  it("blocks ended and pending auctions with a stated reason", () => {
    expect(describeBidBlocker({ ...base, status: "ended" })).toMatch(/ended/i);
    expect(describeBidBlocker({ ...base, status: "pending" })).toMatch(/not opened/i);
  });

  it("blocks a max price below the floor", () => {
    expect(
      describeBidBlocker({ ...base, maxPriceQ96: decimalToQ96("0.000001") }),
    ).toMatch(/floor/i);
  });

  it("blocks an empty amount or price", () => {
    expect(describeBidBlocker({ ...base, amount: 0n })).toMatch(/amount/i);
    expect(describeBidBlocker({ ...base, maxPriceQ96: 0n })).toMatch(/maximum price/i);
  });

  it("blocks an insufficient balance", () => {
    expect(
      describeBidBlocker({ ...base, readiness: readiness({ hasBalance: false }) }),
    ).toMatch(/insufficient/i);
  });
});
