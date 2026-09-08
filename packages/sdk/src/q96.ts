/**
 * Q96 fixed-point helpers.
 *
 * CCA prices are Q96 (value * 2^96). This is the ONLY place in the repo that
 * converts between Q96 and human-readable numbers — web, bot, widget and agent
 * all import from here.
 *
 * TODO(phase-1): q96ToNumber, q96ToDecimalString, numberToQ96, formatPrice.
 */
export const Q96 = 2n ** 96n;
