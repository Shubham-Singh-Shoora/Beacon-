import { decodeEventLog, toEventSelector } from "viem";
import { describe, expect, it, vi } from "vitest";
import { auctionCreatedEvent, scanAuctions } from "../src/discover";
import type { BeaconClient } from "../src/client";
import fixture from "./fixtures/auction-created-log.json";

/**
 * A REAL `AuctionCreated` log, captured from Sepolia with `cast receipt`.
 *
 * Using genuine chain data (rather than a synthetic fixture round-tripped
 * through our own encoder) means these tests fail if the generated ABI ever
 * drifts from the contract that is actually deployed.
 */
const REAL_LOG = fixture.log;

/** topic0 observed on-chain for AuctionCreated. */
const ON_CHAIN_TOPIC0 = "0x7ede475fad18ccf0039f2b956c4d43a8b4ed0853de4daaa8ae25299f331ae3b9";

describe("auctionCreatedEvent", () => {
  it("is resolved from the generated factory ABI", () => {
    expect(auctionCreatedEvent).toBeDefined();
    expect(auctionCreatedEvent.name).toBe("AuctionCreated");
    expect(auctionCreatedEvent.type).toBe("event");
  });

  it("hashes to the topic0 actually emitted on Sepolia", () => {
    // Guards against ABI drift: if upstream changes the event signature, or the
    // ABI is regenerated from a different tag, this fails loudly.
    expect(toEventSelector(auctionCreatedEvent)).toBe(ON_CHAIN_TOPIC0);
    expect(REAL_LOG.topics[0]).toBe(ON_CHAIN_TOPIC0);
  });

  it("indexes auction and token, so they can be filtered server-side", () => {
    const indexed = auctionCreatedEvent.inputs.filter((input) => input.indexed).map((i) => i.name);
    expect(indexed).toEqual(["auction", "token"]);
  });

  it("decodes a real on-chain log", () => {
    const decoded = decodeEventLog({
      abi: [auctionCreatedEvent],
      topics: REAL_LOG.topics as [`0x${string}`, ...`0x${string}`[]],
      data: REAL_LOG.data as `0x${string}`,
    });

    expect(decoded.eventName).toBe("AuctionCreated");
    expect(decoded.args.auction).toBe("0xa26DBABBbF9451F150A87d7635f6891474c4F0FA");
    expect(decoded.args.token).toBe("0x59eB743864BA3008d3A89aFb2b66029269C66088");
    // 1,000 tokens at 18 decimals.
    expect(decoded.args.amount).toBe(1_000n * 10n ** 18n);
    // configData is the ABI-encoded AuctionParameters blob.
    expect(decoded.args.configData.startsWith("0x")).toBe(true);
    expect(decoded.args.configData.length).toBeGreaterThan(2);
  });
});

/** Minimal BeaconClient stand-in that records the ranges scanAuctions requests. */
function makeFakeClient(options: {
  headBlock: bigint;
  getLogs: (args: { fromBlock: bigint; toBlock: bigint }) => Promise<unknown[]>;
}): BeaconClient {
  return {
    publicClient: {
      getBlockNumber: async () => options.headBlock,
      getLogs: options.getLogs,
    },
    chain: { name: "Fake Testnet" },
    chainId: 11155111,
    factoryAddress: "0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5",
    factoryDeployBlock: 0n,
    blockTimeSeconds: 12,
  } as unknown as BeaconClient;
}

describe("scanAuctions chunking", () => {
  it("splits the range into chunks no wider than chunkSize", async () => {
    const ranges: Array<[bigint, bigint]> = [];
    const client = makeFakeClient({
      headBlock: 120_000n,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      },
    });

    await scanAuctions(client, { fromBlock: 0n, chunkSize: 50_000n });

    expect(ranges).toEqual([
      [0n, 49_999n],
      [50_000n, 99_999n],
      [100_000n, 120_000n],
    ]);
  });

  it("covers the full range without gaps or overlaps", async () => {
    const ranges: Array<[bigint, bigint]> = [];
    const client = makeFakeClient({
      headBlock: 137_777n,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      },
    });

    await scanAuctions(client, { fromBlock: 1_000n, chunkSize: 50_000n });

    expect(ranges[0]![0]).toBe(1_000n);
    expect(ranges.at(-1)![1]).toBe(137_777n);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1n);
    }
  });

  it("halves the chunk size and retries when the RPC rejects a range", async () => {
    // Mimics a provider stricter than the configured chunk size, e.g.
    // "-32701: exceed maximum block range: 10000".
    const accepted: Array<[bigint, bigint]> = [];
    const client = makeFakeClient({
      headBlock: 100_000n,
      getLogs: async ({ fromBlock, toBlock }) => {
        if (toBlock - fromBlock + 1n > 10_000n) {
          throw new Error("exceed maximum block range: 10000");
        }
        accepted.push([fromBlock, toBlock]);
        return [];
      },
    });

    await scanAuctions(client, { fromBlock: 0n, chunkSize: 50_000n });

    expect(accepted.length).toBeGreaterThan(0);
    for (const [from, to] of accepted) {
      expect(to - from + 1n).toBeLessThanOrEqual(10_000n);
    }
    // Still covered the whole range despite the failures.
    expect(accepted[0]![0]).toBe(0n);
    expect(accepted.at(-1)![1]).toBe(100_000n);
  });

  it("throws rather than silently returning an empty list when a block fails", async () => {
    const client = makeFakeClient({
      headBlock: 10n,
      getLogs: async () => {
        throw new Error("boom");
      },
    });

    await expect(scanAuctions(client, { fromBlock: 0n, chunkSize: 1n })).rejects.toThrow(/boom/);
  });

  it("returns nothing when the start block is past the head", async () => {
    const getLogs = vi.fn(async () => []);
    const client = makeFakeClient({ headBlock: 100n, getLogs });

    await expect(scanAuctions(client, { fromBlock: 500n })).resolves.toEqual([]);
    expect(getLogs).not.toHaveBeenCalled();
  });

  it("reports progress for long scans", async () => {
    const client = makeFakeClient({ headBlock: 100_000n, getLogs: async () => [] });
    const progress: number[] = [];

    await scanAuctions(client, {
      fromBlock: 0n,
      chunkSize: 50_000n,
      onProgress: (p) => progress.push(Number(p.scannedTo)),
    });

    expect(progress).toEqual([49_999, 99_999, 100_000]);
  });
});
