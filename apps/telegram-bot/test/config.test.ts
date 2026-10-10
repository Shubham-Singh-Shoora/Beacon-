import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("bot startup configuration", () => {
  it("needs only a token for normal per-chat subscriptions", () => {
    const config = loadConfig([], { TELEGRAM_BOT_TOKEN: "test-token" });
    expect(config.telegram.chatId).toBeUndefined();
    expect(config.chains.map((chain) => chain.network.slug).sort()).toEqual(
      ["ethereum", "base", "unichain", "arbitrum", "sepolia"].sort(),
    );
  });
  it("requires an explicit recipient for one-shot delivery", () => {
    expect(() => loadConfig(["--simulate"], { TELEGRAM_BOT_TOKEN: "test-token" })).toThrow(
      "TELEGRAM_CHAT_ID",
    );
  });
  it("allows offline smoke tests without credentials, and cannot send offline simulations", () => {
    expect(loadConfig(["--dry-run", "--simulate", "--offline"], {}).offline).toBe(true);
    expect(() =>
      loadConfig(["--simulate", "--offline"], { TELEGRAM_BOT_TOKEN: "test-token" }),
    ).toThrow("--offline requires");
  });
  it("isolates dry-run subscription writes from the real chat store", () => {
    expect(loadConfig(["--dry-run"], {}).subscriptionsPath).not.toBe(
      loadConfig([], { TELEGRAM_BOT_TOKEN: "test-token" }).subscriptionsPath,
    );
  });
  it("rejects unsupported networks and does not duplicate repeated slugs", () => {
    expect(() => loadConfig(["--dry-run"], { BEACON_BOT_CHAINS: "invalid" })).toThrow(
      "unknown chain",
    );
    expect(loadConfig(["--dry-run"], { BEACON_BOT_CHAINS: "base, base" }).chains).toHaveLength(1);
  });
});
