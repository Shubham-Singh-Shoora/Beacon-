import { describe, expect, it } from "vitest";
import { formatTokenAmount } from "../src/erc20";

const ETH = { symbol: "ETH", decimals: 18 };
const USDC = { symbol: "USDC", decimals: 6 };
const FOLD = { symbol: "FOLD", decimals: 18 };

describe("formatTokenAmount", () => {
  it("formats ordinary amounts with grouping and the real symbol", () => {
    expect(formatTokenAmount(1_000n * 10n ** 18n, FOLD)).toBe("1,000 FOLD");
    expect(formatTokenAmount(960n * 10n ** 18n, FOLD)).toBe("960 FOLD");
    expect(formatTokenAmount(1_234_567n * 10n ** 18n, FOLD)).toBe("1,234,567 FOLD");
  });

  it("respects each token's own decimals rather than assuming 18", () => {
    expect(formatTokenAmount(1_500_000n, USDC)).toBe("1.5 USDC");
    expect(formatTokenAmount(1_500_000n, ETH)).toBe("0.0000000000015 ETH");
  });

  it("never renders a nonzero amount as zero", () => {
    // A real Sepolia auction had currencyRaised = 52 wei. Showing "0 ETH" there
    // makes a working auction look dead.
    const raised = formatTokenAmount(52n, ETH);
    expect(raised).not.toBe("0 ETH");
    expect(raised).toBe("0.000000000000000052 ETH");
    expect(formatTokenAmount(1n, ETH)).toBe("0.000000000000000001 ETH");
  });

  it("still renders an actual zero as zero", () => {
    expect(formatTokenAmount(0n, ETH)).toBe("0 ETH");
  });

  it("trims trailing zeros but keeps meaningful digits", () => {
    expect(formatTokenAmount(10n ** 17n, ETH)).toBe("0.1 ETH");
    expect(formatTokenAmount(10n ** 18n + 10n ** 17n, ETH)).toBe("1.1 ETH");
  });

  it("handles negative amounts", () => {
    expect(formatTokenAmount(-(10n ** 18n), ETH)).toBe("-1 ETH");
  });
});
