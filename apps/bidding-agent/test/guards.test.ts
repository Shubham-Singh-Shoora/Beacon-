import { describe, expect, it } from "vitest";
import { ALLOWED_CHAIN_IDS } from "../src/config";
import {
  GuardError,
  assertSufficientBalance,
  assertTestnetOnly,
  assertWithinPriceCap,
  assertWithinSpendCap,
} from "../src/guards";
import type { AgentConfig } from "../src/config";
import type { BeaconClient } from "@beacon/cca-sdk";

function fakeClient(reportedChainId: number): BeaconClient {
  return {
    publicClient: { getChainId: async () => reportedChainId },
  } as unknown as BeaconClient;
}

function fakeConfig(chainId: number): AgentConfig {
  return { chainId } as unknown as AgentConfig;
}

describe("testnet allowlist", () => {
  it("contains no mainnet chain ids", () => {
    // Fails closed by omission rather than by an invertible condition.
    for (const mainnet of [1, 8453, 130, 42161, 10, 137]) {
      expect(ALLOWED_CHAIN_IDS.has(mainnet)).toBe(false);
    }
    expect(ALLOWED_CHAIN_IDS.has(11155111)).toBe(true);
  });
});

describe("assertTestnetOnly", () => {
  it("passes on an allowed testnet the RPC agrees with", async () => {
    await expect(
      assertTestnetOnly(fakeClient(11155111), fakeConfig(11155111)),
    ).resolves.toBeUndefined();
  });

  it("refuses Ethereum mainnet outright", async () => {
    await expect(assertTestnetOnly(fakeClient(1), fakeConfig(1))).rejects.toThrow(GuardError);
    await expect(assertTestnetOnly(fakeClient(1), fakeConfig(1))).rejects.toThrow(/TESTNET ONLY/);
  });

  it("catches a mainnet RPC hiding behind a testnet chain id in .env", async () => {
    // The dangerous case: config says Sepolia, the endpoint is actually mainnet.
    await expect(
      assertTestnetOnly(fakeClient(1), fakeConfig(11155111)),
    ).rejects.toThrow(/chain id mismatch/i);
  });

  it("refuses an unknown chain even if the RPC agrees", async () => {
    await expect(assertTestnetOnly(fakeClient(31337), fakeConfig(31337))).rejects.toThrow(
      /TESTNET ONLY/,
    );
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
