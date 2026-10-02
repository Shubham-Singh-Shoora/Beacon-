import { describe, expect, it } from "vitest";
import { MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS } from "../src/config";
import {
  GuardError,
  assertSufficientBalance,
  assertChainAllowed,
  assertWithinPriceCap,
  assertWithinSpendCap,
} from "../src/guards";
import type { AgentConfig } from "../src/config";
import type { BeaconClient } from "@hammerock/cca-sdk";

function fakeClient(reportedChainId: number): BeaconClient {
  return {
    publicClient: { getChainId: async () => reportedChainId },
  } as unknown as BeaconClient;
}

function fakeConfig(chainId: number, broadcast = false, allowMainnet = false): AgentConfig {
  return { chainId, broadcast, allowMainnet } as unknown as AgentConfig;
}

describe("chain allowlists", () => {
  it("lists testnets and mainnets separately, with no overlap", () => {
    for (const id of [11155111, 84532, 1301]) expect(TESTNET_CHAIN_IDS.has(id)).toBe(true);
    for (const id of [1, 8453, 130, 42161]) expect(MAINNET_CHAIN_IDS.has(id)).toBe(true);
    for (const id of MAINNET_CHAIN_IDS) expect(TESTNET_CHAIN_IDS.has(id)).toBe(false);
  });

  it("knows no other chain - an unlisted one fails closed by omission", () => {
    for (const id of [10, 137, 31337]) {
      expect(TESTNET_CHAIN_IDS.has(id) || MAINNET_CHAIN_IDS.has(id)).toBe(false);
    }
  });
});

describe("assertChainAllowed", () => {
  const ok = (chainId: number, broadcast: boolean, allowMainnet = false) =>
    assertChainAllowed(fakeClient(chainId), fakeConfig(chainId, broadcast, allowMainnet));

  it("passes on a testnet the RPC agrees with, live or not", async () => {
    await expect(ok(11155111, true)).resolves.toBeUndefined();
    await expect(ok(11155111, false)).resolves.toBeUndefined();
  });

  it("lets a mainnet be READ without any opt-in", async () => {
    await expect(ok(1, false)).resolves.toBeUndefined();
    await expect(ok(8453, false)).resolves.toBeUndefined();
  });

  it("locks mainnet broadcasting without the opt-in", async () => {
    await expect(ok(1, true)).rejects.toThrow(GuardError);
    await expect(ok(1, true)).rejects.toThrow(/MAINNET LOCKED/);
    await expect(ok(42161, true)).rejects.toThrow(/MAINNET LOCKED/);
  });

  it("allows mainnet broadcasting once the operator opts in", async () => {
    await expect(ok(1, true, true)).resolves.toBeUndefined();
  });

  it("catches a mainnet RPC hiding behind a testnet chain id in .env", async () => {
    // The dangerous case: config says Sepolia (no lock), the endpoint is mainnet.
    await expect(
      assertChainAllowed(fakeClient(1), fakeConfig(11155111, true)),
    ).rejects.toThrow(/chain id mismatch/i);
  });

  it("refuses an unknown chain even if the RPC agrees", async () => {
    await expect(ok(31337, false)).rejects.toThrow(/unknown chain/);
  });
});

describe("assertWithinSpendCap", () => {
  it("allows a bid that fits", () => {
    expect(() => assertWithinSpendCap({ spent: 1n, amount: 2n, maxSpend: 5n })).not.toThrow();
  });

  it("allows a bid that exactly reaches the cap", () => {
    expect(() => assertWithinSpendCap({ spent: 3n, amount: 2n, maxSpend: 5n })).not.toThrow();
  });

  it("refuses a bid one unit over the cap", () => {
    expect(() => assertWithinSpendCap({ spent: 4n, amount: 2n, maxSpend: 5n })).toThrow(GuardError);
    expect(() => assertWithinSpendCap({ spent: 4n, amount: 2n, maxSpend: 5n })).toThrow(
      /MAX SPEND EXCEEDED/,
    );
  });
});

describe("assertWithinPriceCap", () => {
  it("allows a bid at or below the cap", () => {
    expect(() =>
      assertWithinPriceCap({ maxPriceQ96: 100n, submittedPriceQ96: 100n }),
    ).not.toThrow();
    expect(() => assertWithinPriceCap({ maxPriceQ96: 100n, submittedPriceQ96: 99n })).not.toThrow();
  });

  it("refuses a bid above the cap", () => {
    expect(() => assertWithinPriceCap({ maxPriceQ96: 100n, submittedPriceQ96: 101n })).toThrow(
      /PRICE CAP EXCEEDED/,
    );
  });
});

describe("assertSufficientBalance", () => {
  it("refuses when the wallet cannot cover the bid", () => {
    expect(() => assertSufficientBalance({ balance: 1n, amount: 2n, symbol: "ETH" })).toThrow(
      /Insufficient ETH/,
    );
    expect(() =>
      assertSufficientBalance({ balance: 2n, amount: 2n, symbol: "ETH" }),
    ).not.toThrow();
  });
});
