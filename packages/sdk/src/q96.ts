/**
 * Q96 fixed-point helpers.
 *
 * CCA encodes prices as Q96: a value multiplied by 2^96. This module is the
 * ONLY place in Beacon that converts between Q96 and human-readable numbers.
 * The web app, widget, bot and agent all import from here rather than
 * reimplementing `/ 2 ** 96` with floating point.
 *
 * Everything here is exact BigInt arithmetic except {@link q96ToNumber}, which
 * is explicitly lossy and documented as such.
 */

/** 2^96 - the Q96 fixed-point scaling factor. */
export const Q96 = 2n ** 96n;

/**
 * MPS ("milli-bips", one thousandth of a basis point) = 1e7.
 *
 * The auction tracks how much of its supply SCHEDULE has been released as a
 * `cumulativeMps` out of `MPS`. Note this tracks the schedule, not sales: an
 * auction that ends with no bids still reaches `MPS`.
 * Mirrors `ConstantsLib.MPS` upstream.
 */
export const MPS = 10_000_000n;

/** X7 values are scaled by MPS to avoid intermediate division. Mirrors `ValueX7`. */
export const X7 = MPS;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Convert a Q96 value to an exact decimal string.
 *
 * Exact for the requested precision - the fractional part is computed with
 * BigInt division and truncated (never rounded up), so the result never
 * overstates a price.
 *
 * @param valueQ96 The Q96-encoded value.
 * @param precision Fractional digits to emit. Defaults to 18.
 * @param trimTrailingZeros Drop trailing fractional zeros. Defaults to true.
 */
export function q96ToDecimalString(
  valueQ96: bigint,
  precision = 18,
  trimTrailingZeros = true,
): string {
  if (precision < 0 || !Number.isInteger(precision)) {
    throw new TypeError(
      `q96ToDecimalString: precision must be a non-negative integer, got ${precision}`,
    );
  }

  const negative = valueQ96 < 0n;
  const magnitude = negative ? -valueQ96 : valueQ96;

  const whole = magnitude / Q96;
  const remainder = magnitude % Q96;

  if (precision === 0) {
    return `${negative && whole !== 0n ? "-" : ""}${whole}`;
  }

  const scale = 10n ** BigInt(precision);
  // Truncating division: never rounds a price up.
  const fractional = (remainder * scale) / Q96;

  let fractionalDigits = fractional.toString().padStart(precision, "0");
  if (trimTrailingZeros) {
    fractionalDigits = fractionalDigits.replace(/0+$/, "");
  }

  const sign = negative && (whole !== 0n || fractional !== 0n) ? "-" : "";
  return fractionalDigits.length > 0 ? `${sign}${whole}.${fractionalDigits}` : `${sign}${whole}`;
}

/**
 * Convert a Q96 value to a JavaScript number.
 *
 * LOSSY. `number` is a float64, so values beyond ~2^53 or with more than ~15
 * significant digits lose precision. Use for charts, sorting and display only -
 * never for anything that gets sent back on-chain. Use
 * {@link q96ToDecimalString} when exactness matters.
 */
export function q96ToNumber(valueQ96: bigint): number {
  return Number(q96ToDecimalString(valueQ96, 20, false));
}

/**
 * Convert a decimal value to Q96, exactly.
 *
 * Accepts a string (preferred - no float rounding) or a number. Fractional
 * digits beyond what Q96 can represent are truncated.
 *
 * @throws TypeError on a malformed or non-finite input.
 */
export function decimalToQ96(decimal: string | number): bigint {
  const asString = typeof decimal === "number" ? numberToDecimalString(decimal) : decimal.trim();

  if (!DECIMAL_PATTERN.test(asString)) {
    throw new TypeError(`decimalToQ96: expected a decimal string, got "${decimal}"`);
  }

  const negative = asString.startsWith("-");
  const unsigned = negative ? asString.slice(1) : asString;
  const [wholePart = "0", fractionalPart = ""] = unsigned.split(".");

  const scale = 10n ** BigInt(fractionalPart.length);
  const scaledValue =
    BigInt(wholePart) * scale + (fractionalPart === "" ? 0n : BigInt(fractionalPart));

  const result = (scaledValue * Q96) / scale;
  return negative ? -result : result;
}

function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`decimalToQ96: expected a finite number, got ${value}`);
  }
  // Avoid exponential notation ("1e-7"), which the decimal parser rejects.
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

/**
 * Format a Q96 value for human display.
 *
 * Unlike {@link q96ToDecimalString}, which truncates for exactness, this ROUNDS
 * half-up at the chosen precision. That matters: 0.0001 is not exactly
 * representable in Q96, so a truncating formatter renders it as
 * "0.0000999999999999" - technically accurate and useless in a UI.
 *
 * For values below 1 the digit budget starts at the first non-zero digit, so
 * very small prices stay readable instead of showing a wall of zeros.
 *
 * @param significantDigits Digits to keep after the first significant one
 *   (or fractional digits, for values >= 1). Defaults to 6.
 */
export function formatQ96(valueQ96: bigint, significantDigits = 6): string {
  if (valueQ96 === 0n) return "0";

  const negative = valueQ96 < 0n;
  const magnitude = negative ? -valueQ96 : valueQ96;
  const sign = negative ? "-" : "";

  let precision: number;
  if (magnitude / Q96 > 0n) {
    precision = significantDigits;
  } else {
    const fractional = q96ToDecimalString(magnitude, 40, false).split(".")[1] ?? "";
    const firstSignificant = fractional.search(/[1-9]/);
    if (firstSignificant === -1) return "0";
    precision = firstSignificant + significantDigits;
  }

  const scale = 10n ** BigInt(precision);
  // Round half-up: floor(v * scale / Q96 + 1/2), done in integer arithmetic.
  const rounded = (magnitude * scale * 2n + Q96) / (Q96 * 2n);

  const wholePart = rounded / scale;
  const fractionalPart = (rounded % scale)
    .toString()
    .padStart(precision, "0")
    .replace(/0+$/, "");

  return fractionalPart.length > 0 ? `${sign}${wholePart}.${fractionalPart}` : `${sign}${wholePart}`;
}

/**
 * Fraction of the supply schedule released so far, from a checkpoint's
 * `cumulativeMps`. Returns a value in [0, 1]. Not the fraction sold.
 */
export function mpsToFraction(cumulativeMps: bigint | number): number {
  return Number(BigInt(cumulativeMps)) / Number(MPS);
}

/** Percentage of the supply schedule released so far, e.g. `"12.34"`. */
export function formatMpsPercent(cumulativeMps: bigint | number, fractionDigits = 2): string {
  return (mpsToFraction(cumulativeMps) * 100).toFixed(fractionDigits);
}

/** Unwrap a ValueX7 (a value pre-multiplied by MPS) back to its base units. */
export function fromValueX7(valueX7: bigint): bigint {
  return valueX7 / X7;
}
