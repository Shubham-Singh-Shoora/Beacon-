import { describe, expect, it } from "vitest";
import {
  formatMpsPercent,
  formatQ96,
  formatQ96Compact,
  fromValueX7,
  MPS,
  mpsToFraction,
  Q96,
  decimalToQ96,
  q96ToDecimalString,
  q96ToNumber,
} from "../src/q96";

/**
 * A real floor price read from the live Sepolia auction
 * 0xa26dbabbbf9451f150a87d7635f6891474c4f0fa.
 *
 * Truncated to 30dp its exact value is 0.000000000000000999999999999995,
 * computed independently with integer arithmetic (`(v * 10**30) // 2**96` in
 * Python) rather than with the code under test. It sits just BELOW 1e-15, which
 * makes it a good probe for truncate-vs-round behaviour.
 */
const REAL_FLOOR_PRICE_Q96 = 79228162514264n;

describe("Q96 constants", () => {
  it("matches 2^96", () => {
    expect(Q96).toBe(79228162514264337593543950336n);
  });

  it("MPS is 1e7 milli-bips, mirroring ConstantsLib.MPS", () => {
    expect(MPS).toBe(10_000_000n);
  });
});

describe("q96ToDecimalString", () => {
  it("converts whole and fractional values", () => {
    expect(q96ToDecimalString(Q96)).toBe("1");
    expect(q96ToDecimalString(Q96 / 2n)).toBe("0.5");
    expect(q96ToDecimalString(Q96 * 3n)).toBe("3");
    expect(q96ToDecimalString(0n)).toBe("0");
  });

  it("truncates rather than rounds, so a price is never overstated", () => {
    // Exact value starts 0.000000000000000999999999999995... - rounding to 18dp
    // would give ...001000; truncating gives ...000999.
    expect(q96ToDecimalString(REAL_FLOOR_PRICE_Q96, 18)).toBe("0.000000000000000999");
  });

  it("reproduces the independently computed exact expansion", () => {
    expect(q96ToDecimalString(REAL_FLOOR_PRICE_Q96, 30, false)).toBe(
      "0.000000000000000999999999999995",
    );
  });

  it("honours precision and trailing-zero trimming", () => {
    expect(q96ToDecimalString(Q96 / 2n, 18, false)).toBe("0.500000000000000000");
    expect(q96ToDecimalString(Q96 / 2n, 2)).toBe("0.5");
    expect(q96ToDecimalString(Q96 + Q96 / 2n, 0)).toBe("1");
  });

  it("handles negative values", () => {
    expect(q96ToDecimalString(-Q96)).toBe("-1");
    expect(q96ToDecimalString(-Q96 / 2n)).toBe("-0.5");
  });

  it("rejects an invalid precision", () => {
    expect(() => q96ToDecimalString(Q96, -1)).toThrow(TypeError);
    expect(() => q96ToDecimalString(Q96, 1.5)).toThrow(TypeError);
  });
});

describe("decimalToQ96", () => {
  it("converts exactly for representable values", () => {
    expect(decimalToQ96("1")).toBe(Q96);
    expect(decimalToQ96("0.5")).toBe(Q96 / 2n);
    expect(decimalToQ96("0")).toBe(0n);
    expect(decimalToQ96("-1")).toBe(-Q96);
  });

  it("accepts numbers without falling into exponential notation", () => {
    // `(1e-7).toString()` is "1e-7", which a naive parser rejects.
    expect(decimalToQ96(1e-7)).toBe(decimalToQ96("0.0000001"));
    expect(decimalToQ96(2)).toBe(Q96 * 2n);
  });

  it("round-trips exactly for values Q96 can represent", () => {
    for (const value of ["1", "0.5", "0.25", "3", "0.125"]) {
      expect(q96ToDecimalString(decimalToQ96(value))).toBe(value);
    }
  });

  it("round-trips a non-representable value to within one unit of precision", () => {
    // 0.0001 is not exactly representable in Q96. decimalToQ96 truncates down,
    // so the exact expansion comes back a hair under - which is correct, and is
    // exactly why formatQ96 (the display path) rounds instead.
    const roundTripped = q96ToDecimalString(decimalToQ96("0.0001"), 18);
    expect(roundTripped).toBe("0.000099999999999999");
    expect(formatQ96(decimalToQ96("0.0001"))).toBe("0.0001");
  });

  it("rejects malformed input instead of silently producing 0", () => {
    for (const bad of ["", "abc", "1e-7", "1.2.3", "0x10", " ", "--1"]) {
      expect(() => decimalToQ96(bad)).toThrow(TypeError);
    }
    expect(() => decimalToQ96(Number.NaN)).toThrow(TypeError);
    expect(() => decimalToQ96(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("q96ToNumber", () => {
  it("converts to a float for display", () => {
    expect(q96ToNumber(Q96)).toBe(1);
    expect(q96ToNumber(Q96 / 2n)).toBe(0.5);
    expect(q96ToNumber(0n)).toBe(0);
  });

  it("approximates the real floor price", () => {
    expect(q96ToNumber(REAL_FLOOR_PRICE_Q96)).toBeCloseTo(1e-15, 18);
  });
});

describe("formatQ96", () => {
  it("keeps significant digits for very small prices", () => {
    // The interesting digits start 15 places in; a naive 6dp format shows "0".
    // Six significant digits of 9.99999999...e-16 rounds to 1e-15.
    expect(formatQ96(REAL_FLOOR_PRICE_Q96)).toBe("0.000000000000001");
    // With a wide enough budget the true digits show instead of rounding to 1e-15.
    expect(formatQ96(REAL_FLOOR_PRICE_Q96, 20)).toBe("0.00000000000000099999999999999573897");
  });

  it("rounds rather than truncates, so round numbers display as round numbers", () => {
    expect(formatQ96(decimalToQ96("0.0001"))).toBe("0.0001");
    expect(formatQ96(decimalToQ96("0.05"))).toBe("0.05");
  });

  it("formats ordinary values", () => {
    expect(formatQ96(Q96)).toBe("1");
    expect(formatQ96(Q96 / 2n)).toBe("0.5");
    expect(formatQ96(0n)).toBe("0");
  });

  it("respects the significant-digit budget above 1", () => {
    // Rounds at the 4th fractional digit: ...6789 -> ...678|9 rounds up.
    expect(formatQ96(decimalToQ96("123.456789123"), 4)).toBe("123.4568");
  });
});

describe("supply schedule helpers", () => {
  it("treats cumulativeMps as a fraction of MPS", () => {
    expect(mpsToFraction(5_000_000n)).toBe(0.5);
    expect(mpsToFraction(MPS)).toBe(1);
    expect(mpsToFraction(0)).toBe(0);
  });

  it("formats a percentage", () => {
    expect(formatMpsPercent(1_234_567n)).toBe("12.35");
    expect(formatMpsPercent(MPS)).toBe("100.00");
  });

  it("unwraps ValueX7 back to base units", () => {
    expect(fromValueX7(MPS * 42n)).toBe(42n);
  });
});

describe("formatQ96Compact", () => {
  it("switches to scientific notation for very small prices", () => {
    // A real Sepolia clearing price. Plain, this is 25 characters of zeros.
    const realClearingPrice = 4295100000n;
    expect(formatQ96(realClearingPrice)).toBe("0.0000000000000000000542118");
    expect(formatQ96Compact(realClearingPrice)).toBe("5.42118e-20");
  });

  it("leaves comfortably readable values alone", () => {
    expect(formatQ96Compact(Q96)).toBe("1");
    expect(formatQ96Compact(Q96 / 2n)).toBe("0.5");
    expect(formatQ96Compact(decimalToQ96("0.0001"))).toBe("0.0001");
    expect(formatQ96Compact(decimalToQ96("0.000001"))).toBe("0.000001");
    expect(formatQ96Compact(0n)).toBe("0");
  });

  it("agrees with formatQ96 on the digits it shows", () => {
    // Same rounding, so a compact price never contradicts the plain one.
    const value = 79228162514264n;
    expect(formatQ96(value)).toBe("0.000000000000001");
    expect(formatQ96Compact(value)).toBe("1e-15");
  });

  it("handles negatives", () => {
    expect(formatQ96Compact(-4295100000n)).toBe("-5.42118e-20");
  });
});
