import { describe, expect, it } from "vitest";
import { createBeaconClient } from "../src/client";
import type { BeaconClient } from "../src/client";
import {
  FACTORIES,
  FACTORY_DEPLOY_BLOCK,
  factoriesOnChain,
  factoryVersionOf,
  isTestnet,
} from "../src/constants";
import { scanAuctions } from "../src/discover";
import { sanitizeTokenText } from "../src/erc20";
import { MemoryAuctionStore } from "../src/store";
import { syncAuctions } from "../src/sync";

const RPC = "http://127.0.0.1:1"; // never contacted - construction is offline
const V210 = "0x000000001F26a0044BaA66024e7b6599c61963F8";
const V200 = "0x00cCa200BF124dBfA848937c553864f4B4CE0632";
const V110 = "0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5";

describe("chains", () => {
  it("reads every mainnet with a CCA deployment", () => {
    for (const chainId of [1, 8453, 130, 42161]) {
      const client = createBeaconClient({ rpcUrl: RPC, chainId });
      expect(client.factoryAddresses).toEqual([V210, V200, V110]);
      expect(client.factoryAddress).toBe(V210);
      expect(isTestnet(chainId)).toBe(false);
    }
  });

  it("treats only the three known testnets as testnets", () => {
    expect([11155111, 84532, 1301].every(isTestnet)).toBe(true);
    expect(isTestnet(999_999)).toBe(false); // unknown is NOT a testnet
  });

  it("still rejects chains with no CCA deployment", () => {
    expect(() => createBeaconClient({ rpcUrl: RPC, chainId: 10 })).toThrow(/does not support/);
  });
});

describe("factory versions", () => {
  it("lists v2.1.0 first - the version new auctions use", () => {
    expect(FACTORIES.map((f) => f.version)).toEqual(["v2.1.0", "v2.0.0", "v1.1.0"]);
  });

  it("starts discovery at the earliest factory on each chain", () => {
    expect(FACTORY_DEPLOY_BLOCK[1]).toBe(24321671n); // v1.1.0 on Ethereum
    expect(FACTORY_DEPLOY_BLOCK[11155111]).toBe(10130119n);
  });

  it("only scans factories actually deployed on the chain", () => {
    // v2.0.0 was never deployed to Unichain Sepolia.
    expect(factoriesOnChain(1301).map((f) => f.version)).toEqual(["v2.1.0", "v1.1.0"]);
  });

  it("identifies an auction's version from its factory, case-insensitively", () => {
    expect(factoryVersionOf(V200.toLowerCase() as `0x${string}`)).toBe("v2.0.0");
    expect(factoryVersionOf("0x0000000000000000000000000000000000000001")).toBeUndefined();
  });
});

function fakeClient(getLogs: (args: { address: unknown; fromBlock: bigint }) => unknown[]): BeaconClient {
  const rpc = {
    getBlockNumber: async () => 12_000_000n,
    getLogs: async (args: { address: unknown; fromBlock: bigint }) => getLogs(args),
  };
  return {
    publicClient: rpc,
    logsClient: rpc,
    chain: { name: "Fake" },
    chainId: 11155111,
    factoryAddress: V210,
    factoryAddresses: [V210, V200, V110],
    factoryDeployBlock: 10_130_119n,
    blockTimeSeconds: 12,
  } as unknown as BeaconClient;
}

const log = (factory: string, auction: string, blockNumber: bigint) => ({
  address: factory,
  args: { auction, token: auction, amount: 1n, configData: "0x" },
  blockNumber,
  transactionHash: "0x01",
  logIndex: 0,
});

describe("multi-factory discovery", () => {
  it("asks for every factory in one getLogs and records which one emitted", async () => {
    const seen: unknown[] = [];
    const client = fakeClient(({ address, fromBlock }) => {
      seen.push(address);
      return fromBlock === 11_000_000n
        ? [
            log(V210, "0x00000000000000000000000000000000000000a1", 11_000_001n),
            log(V110, "0x00000000000000000000000000000000000000b2", 11_000_002n),
          ]
        : [];
    });

    const found = await scanAuctions(client, {
      fromBlock: 11_000_000n,
      toBlock: 11_000_010n,
      emptyChunkRetries: 0,
    });

    expect(seen[0]).toEqual([V210, V200, V110]);
    expect(found.map((a) => factoryVersionOf(a.factory!))).toEqual(["v2.1.0", "v1.1.0"]);
  });

  it("rescans from the start when the store never covered a factory", async () => {
    // A pre-v0.2 store: scanned v1.1.0 only, watermark near the head. Resuming
    // from that watermark would silently skip every earlier v2 auction.
    const store = new MemoryAuctionStore();
    await store.merge({
      chainId: 11155111,
      factoryAddress: V110,
      factoryAddresses: [V110],
      lastSyncedBlock: 11_900_000n,
      auctions: [],
    });

    const starts: bigint[] = [];
    const client = fakeClient(({ fromBlock }) => {
      starts.push(fromBlock);
      return [];
    });
    const result = await syncAuctions(client, store, { chunkSize: 5_000_000n });

    expect(result.scannedFrom).toBe(10_130_119n);
    expect(starts[0]).toBe(10_130_119n);
    expect((await store.read())!.factoryAddresses).toEqual([V210, V200, V110]);
  });

  it("resumes from the watermark once every factory is covered", async () => {
    const store = new MemoryAuctionStore();
    await store.merge({
      chainId: 11155111,
      factoryAddress: V210,
      factoryAddresses: [V210, V200, V110],
      lastSyncedBlock: 11_900_000n,
      auctions: [],
    });
    const client = fakeClient(() => []);
    // Resumes ~6h (1,800 blocks at the 300/h default) BEHIND the watermark, so
    // a chunk a flaky endpoint answered falsely-empty gets a second look.
    const result = await syncAuctions(client, store, { chunkSize: 5_000_000n });
    expect(result.scannedFrom).toBe(11_900_000n - 1_800n);
    const exact = await syncAuctions(client, store, { chunkSize: 5_000_000n, overlapBlocks: 0n });
    expect(exact.scannedFrom).toBe(12_000_000n); // watermark advanced to the head
  });

  it("falls back to Blockscout when the RPC refuses the range", async () => {
    const store = new MemoryAuctionStore();
    await store.merge({
      chainId: 11155111,
      factoryAddress: V210,
      factoryAddresses: [V210, V200, V110],
      lastSyncedBlock: 11_900_000n,
      auctions: [],
    });
    const client = {
      ...fakeClient(() => {
        throw new Error("Archive requests require a personal token");
      }),
      network: { chainId: 11155111, historicalLogs: false, blocksPerHour: 300, blockscout: "example.invalid" },
    } as unknown as BeaconClient;
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "0", message: "No records found", result: [] }))) as typeof fetch;

    // Inject the fake fetch for the Blockscout path.
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const result = await syncAuctions(client, store, { chunkSize: 5_000_000n });
      expect(result.source).toBe("blockscout");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("sanitizeTokenText", () => {
  it("strips the markup injection found in live Sepolia auction names", () => {
    // Real token name from auction 0x0055ffd3...28b8 (shortened payload).
    const real =
      '<highlight tag=svg display="none" width="0" height="0"><highlight tag=script ' +
      'href="/entry-gateway/uniswap.liquidity.v2.LiquidityService/GetPosition?connect=v1"/>' +
      "</highlight> POC Auction One";
    expect(sanitizeTokenText(real, 48)).toBe("POC Auction One");
  });

  it("removes terminal escape codes that could rewrite what is on screen", () => {
    expect(sanitizeTokenText("USDC\u001b[2K\u001b[1Afake", 16)).toBe("USDC[2K[1Afake");
    expect(sanitizeTokenText("USDC\u001b[2K", 16)).not.toContain("\u001b");
  });

  it("removes bidi overrides and zero-width characters", () => {
    expect(sanitizeTokenText("ab‮cd​ef", 16)).toBe("abcdef");
  });

  it("caps length and marks the cut", () => {
    expect(sanitizeTokenText("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 8)).toBe("ABCDEFG…");
  });

  it("returns undefined when nothing readable is left, so callers fall back", () => {
    expect(sanitizeTokenText("<script></script>\u0000", 16)).toBeUndefined();
  });

  it("leaves ordinary names alone", () => {
    expect(sanitizeTokenText("Wrapped Ether", 48)).toBe("Wrapped Ether");
  });
});
