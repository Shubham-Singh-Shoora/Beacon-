import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { auctionAbi } from "../src/abis";
import {
  MAX_BLOCK_NUMBER,
  computeExitHints,
  decideBidAction,
  encodeClaim,
  encodeExit,
} from "../src/settle";
import type { AuctionSettleState, BidData, CheckpointLink } from "../src/settle";

const AUCTION = "0x00000000000000000000000000000000000000aa";
const OWNER = "0x00000000000000000000000000000000000000bb";

/** A checkpoint list with the given (block, price) pairs, linked in order. */
function chainOf(points: Array<[number, number]>): CheckpointLink[] {
  return points.map(([block, price], i) => ({
    block: BigInt(block),
    clearingPriceQ96: BigInt(price),
    prev: i === 0 ? 0n : BigInt(points[i - 1]![0]),
    next: i === points.length - 1 ? MAX_BLOCK_NUMBER : BigInt(points[i + 1]![0]),
  }));
}

function bid(overrides: Partial<BidData> = {}): BidData {
  return {
    id: 1n,
    owner: OWNER,
    startBlock: 100n,
    exitedBlock: 0n,
    maxPriceQ96: 50n,
    amountQ96: 1000n,
    tokensFilled: 0n,
    ...overrides,
  };
}

function state(overrides: Partial<AuctionSettleState> = {}): AuctionSettleState {
  return {
    headBlock: 1000n,
    endBlock: 500n,
    claimBlock: 500n,
    graduated: true,
    clearingPriceQ96: 40n,
    ...overrides,
  };
}

describe("computeExitHints - the contract's own rules", () => {
  // Prices never decrease along the list.
  const chain = chainOf([
    [90, 10],
    [100, 20], // bid placed here
    [150, 40],
    [200, 50], // reaches the bid's max price
    [250, 50],
    [300, 60], // outbid
    [400, 70],
  ]);

  it("picks the last checkpoint below P and the first above it", () => {
    const r = computeExitHints(chain, bid(), state({ clearingPriceQ96: 70n }));
    expect(r.hints).toEqual({ lastFullyFilledCheckpointBlock: 150n, outbidBlock: 300n });
  });

  it("satisfies every condition exitPartiallyFilledBid checks", () => {
    const P = 50n;
    const { hints } = computeExitHints(chain, bid(), state({ clearingPriceQ96: 70n }));
    const at = (b: bigint) => chain.find((c) => c.block === b)!;
    const last = at(hints!.lastFullyFilledCheckpointBlock);
    const outbid = at(hints!.outbidBlock);
    expect(last.clearingPriceQ96 < P).toBe(true);
    expect(at(last.next).clearingPriceQ96 >= P).toBe(true);
    expect(last.block >= 100n).toBe(true);
    expect(outbid.clearingPriceQ96 > P).toBe(true);
    expect(at(outbid.prev).clearingPriceQ96 <= P).toBe(true);
  });

  it("ignores checkpoints before the bid was placed", () => {
    const r = computeExitHints(chain, bid({ startBlock: 150n, maxPriceQ96: 45n }), state());
    expect(r.hints!.lastFullyFilledCheckpointBlock).toBe(150n);
  });

  it("uses outbid = 0 when the auction ended exactly at the bid's price", () => {
    const flat = chainOf([
      [100, 20],
      [200, 50],
    ]);
    const r = computeExitHints(flat, bid(), state({ clearingPriceQ96: 50n }));
    expect(r.hints).toEqual({ lastFullyFilledCheckpointBlock: 100n, outbidBlock: 0n });
  });

  it("points outbid at the end block when only the final checkpoint crossed P", () => {
    const short = chainOf([
      [100, 20],
      [200, 40],
    ]);
    const r = computeExitHints(short, bid(), state({ clearingPriceQ96: 80n, endBlock: 500n }));
    expect(r.hints).toEqual({ lastFullyFilledCheckpointBlock: 200n, outbidBlock: 500n });
  });

  it("refuses to guess before the end if the outbid is not checkpointed yet", () => {
    const short = chainOf([
      [100, 20],
      [200, 40],
    ]);
    const r = computeExitHints(short, bid(), state({ headBlock: 300n, endBlock: 500n, clearingPriceQ96: 80n }));
    expect(r.hints).toBeUndefined();
  });

  it("refuses when the chain does not include the bid's start checkpoint", () => {
    const r = computeExitHints(chainOf([[150, 40]]), bid(), state());
    expect(r.hints).toBeUndefined();
  });
});

describe("decideBidAction", () => {
  const chain = chainOf([
    [100, 20],
    [200, 50],
    [300, 60],
  ]);

  it("refunds everything when the auction did not graduate", () => {
    expect(decideBidAction(bid(), state({ graduated: false }), chain).kind).toBe("exit");
  });

  it("waits on an ungraduated auction that is still running", () => {
    expect(decideBidAction(bid(), state({ graduated: false, headBlock: 300n }), chain).kind).toBe("wait");
  });

  it("exits a winning bid with a plain exitBid", () => {
    expect(decideBidAction(bid({ maxPriceQ96: 90n }), state({ clearingPriceQ96: 60n }), chain).kind).toBe("exit");
  });

  it("exits an outbid bid with hints", () => {
    const a = decideBidAction(bid(), state({ clearingPriceQ96: 60n }), chain);
    expect(a.kind).toBe("exitPartial");
  });

  it("allows an early exit once outbid, before the end", () => {
    const a = decideBidAction(bid(), state({ headBlock: 350n, clearingPriceQ96: 60n }), chain);
    expect(a.kind).toBe("exitPartial");
  });

  it("leaves an active, not-outbid bid alone", () => {
    const a = decideBidAction(bid({ maxPriceQ96: 90n }), state({ headBlock: 350n, clearingPriceQ96: 60n }), chain);
    expect(a.kind).toBe("wait");
  });

  it("claims after exit once the claim block passes", () => {
    const exited = bid({ exitedBlock: 600n, tokensFilled: 5n });
    expect(decideBidAction(exited, state(), chain).kind).toBe("claim");
    expect(decideBidAction(exited, state({ claimBlock: 2000n }), chain).kind).toBe("wait");
  });

  it("is done when exited and nothing is owed", () => {
    expect(decideBidAction(bid({ exitedBlock: 600n }), state(), chain).kind).toBe("done");
  });
});

describe("encoding", () => {
  it("encodes exitPartiallyFilledBid with the hints in order", () => {
    const tx = encodeExit(AUCTION, 7n, {
      kind: "exitPartial",
      reason: "",
      hints: { lastFullyFilledCheckpointBlock: 150n, outbidBlock: 300n },
    });
    const decoded = decodeFunctionData({ abi: auctionAbi, data: tx.data });
    expect(decoded.functionName).toBe("exitPartiallyFilledBid");
    expect(decoded.args).toEqual([7n, 150n, 300n]);
  });

  it("uses claimTokens for one bid and claimTokensBatch for several", () => {
    expect(decodeFunctionData({ abi: auctionAbi, data: encodeClaim(AUCTION, OWNER, [3n]).data }).functionName).toBe(
      "claimTokens",
    );
    const batch = decodeFunctionData({ abi: auctionAbi, data: encodeClaim(AUCTION, OWNER, [3n, 4n]).data });
    expect(batch.functionName).toBe("claimTokensBatch");
    expect(batch.args).toEqual([OWNER, [3n, 4n]]);
  });
});
