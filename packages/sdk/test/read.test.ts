import { decodeFunctionResult } from "viem";
import { describe, expect, it } from "vitest";
import { auctionStateLensAbi, auctionStateLensDeployedBytecode } from "../src/abis";
import { deriveStatus } from "../src/read";
import { MPS, mpsToFraction } from "../src/q96";
import type { AuctionInfo } from "../src/types";
import fixture from "./fixtures/auction-state.json";

/**
 * REAL `AuctionStateLens.state()` return data, captured from Sepolia via an
 * `eth_call` state override against auction
 * 0xa26dbabbbf9451f150a87d7635f6891474c4f0fa.
 *
 * The expected values below were decoded independently (word-by-word in Python)
 * rather than with viem, so this is a genuine cross-check of the ABI, not a
 * round-trip through our own encoder.
 */
const RETURN_DATA = fixture.returnData as `0x${string}`;

describe("AuctionStateLens ABI", () => {
  it("carries deployed bytecode for the state-override read path", () => {
    // Without this, getAuctionState cannot work on an RPC with no deployed lens.
    expect(auctionStateLensDeployedBytecode.startsWith("0x")).toBe(true);
    expect(auctionStateLensDeployedBytecode.length).toBeGreaterThan(1000);
  });

  it("exposes state() as non-view, which is why it must be eth_call'd", () => {
    const stateFn = auctionStateLensAbi.find(
      (entry) => entry.type === "function" && entry.name === "state",
    );
    expect(stateFn).toBeDefined();
    // If this ever becomes "view", read.ts could be simplified to readContract.
    expect(stateFn && "stateMutability" in stateFn && stateFn.stateMutability).toBe("nonpayable");
  });
});

describe("decoding a real lens response", () => {
  const decoded = decodeFunctionResult({
    abi: auctionStateLensAbi,
    functionName: "state",
    data: RETURN_DATA,
  }) as unknown as {
    checkpoint: {
      clearingPrice: bigint;
      currencyRaisedAtClearingPriceQ96_X7: bigint;
      cumulativeMpsPerPrice: bigint;
      cumulativeMps: number;
      prev: bigint;
      next: bigint;
    };
    currencyRaised: bigint;
    totalCleared: bigint;
    isGraduated: boolean;
  };

  it("is exactly 288 bytes, the length the lens reverts with", () => {
    expect((RETURN_DATA.length - 2) / 2).toBe(288);
  });

  it("decodes every field to the independently computed value", () => {
    expect(decoded.checkpoint.clearingPrice).toBe(79228162514264n);
    expect(decoded.checkpoint.currencyRaisedAtClearingPriceQ96_X7).toBe(0n);
    expect(decoded.checkpoint.cumulativeMpsPerPrice).toBe(
      792281625142646751870879006734384960763974393124452n,
    );
    expect(decoded.checkpoint.cumulativeMps).toBe(10_000_000);
    expect(decoded.checkpoint.prev).toBe(0n);
    expect(decoded.checkpoint.next).toBe(18446744073709551615n); // type(uint64).max
    expect(decoded.currencyRaised).toBe(0n);
    expect(decoded.totalCleared).toBe(0n);
    expect(decoded.isGraduated).toBe(false);
  });

  it("shows why cumulativeMps is NOT 'tokens sold'", () => {
    // This auction ended having sold nothing at all...
    expect(decoded.currencyRaised).toBe(0n);
    expect(decoded.totalCleared).toBe(0n);
    expect(decoded.isGraduated).toBe(false);
    // ...yet cumulativeMps is at 100% of MPS, because the supply SCHEDULE fully
    // elapsed. Reporting this as "100% sold" would be badly misleading.
    expect(BigInt(decoded.checkpoint.cumulativeMps)).toBe(MPS);
    expect(mpsToFraction(decoded.checkpoint.cumulativeMps)).toBe(1);
  });
});

describe("deriveStatus", () => {
  const info = { startBlock: 100n, endBlock: 200n } as AuctionInfo;

  it("classifies the auction lifecycle by block number", () => {
    expect(deriveStatus(info, 99n)).toBe("pending");
    expect(deriveStatus(info, 100n)).toBe("live");
    expect(deriveStatus(info, 150n)).toBe("live");
    expect(deriveStatus(info, 200n)).toBe("live"); // inclusive of the end block
    expect(deriveStatus(info, 201n)).toBe("ended");
  });
});
