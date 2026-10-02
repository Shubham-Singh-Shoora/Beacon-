import { describe, expect, it } from "vitest";
import { createBeaconClient, requireFactoryDeployBlock } from "../src/client";

const RPC = "http://127.0.0.1:1"; // never contacted - construction is offline

describe("factory deploy block", () => {
  it("is known for every supported testnet", () => {
    for (const [chainId, block] of [
      [11155111, 10130119n],
      [84532, 36881822n],
      [1301, 42808833n],
    ] as const) {
      const client = createBeaconClient({ rpcUrl: RPC, chainId });
      expect(requireFactoryDeployBlock(client)).toBe(block);
    }
  });

  it("is not needed to build a client - only discovery requires it", () => {
    // Regression: `cca-agent init` on Unichain Sepolia failed to read a single
    // auction because client construction demanded a discovery start block.
    const client = createBeaconClient({ rpcUrl: RPC, chainId: 1301 });
    const withoutBlock = { ...client, factoryDeployBlock: undefined };
    expect(() => requireFactoryDeployBlock(withoutBlock)).toThrow(/factoryDeployBlock/);
  });

  it("honours an explicit override", () => {
    const client = createBeaconClient({ rpcUrl: RPC, chainId: 1301, factoryDeployBlock: 5n });
    expect(requireFactoryDeployBlock(client)).toBe(5n);
  });
});
