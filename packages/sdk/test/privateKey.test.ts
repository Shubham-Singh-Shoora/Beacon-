import { describe, expect, it } from "vitest";
import { isValidPrivateKey, normalizePrivateKey, PrivateKeyFormatError } from "../src/privateKey";

// A throwaway key that exists only in this test file.
const BODY = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("normalizePrivateKey", () => {
  it("accepts a key with the 0x prefix", () => {
    expect(normalizePrivateKey(`0x${BODY}`, "KEY")).toBe(`0x${BODY}`);
  });

  it("accepts a bare key and adds the prefix", () => {
    // Several wallets export without the prefix; rejecting those just pushes
    // the user to edit the key by hand somewhere less safe.
    expect(normalizePrivateKey(BODY, "KEY")).toBe(`0x${BODY}`);
  });

  it("tolerates surrounding whitespace and uppercase", () => {
    expect(normalizePrivateKey(`  0X${BODY.toUpperCase()}  `, "KEY")).toBe(`0x${BODY}`);
  });

  it("rejects a wrong-length value without echoing it", () => {
    const error = (() => {
      try {
        normalizePrivateKey("deadbeef", "MY_KEY");
      } catch (e) {
        return e as Error;
      }
    })();

    expect(error).toBeInstanceOf(PrivateKeyFormatError);
    expect(error!.message).toContain("MY_KEY");
    expect(error!.message).toContain("8 characters");
    // The key material must never appear in an error message.
    expect(error!.message).not.toContain("deadbeef");
  });

  it("rejects the all-zeros placeholder from .env.example", () => {
    expect(() => normalizePrivateKey(`0x${"0".repeat(64)}`, "KEY")).toThrow(/placeholder/);
  });

  it("rejects an absent or empty value", () => {
    expect(() => normalizePrivateKey(undefined, "KEY")).toThrow(/not set/);
    expect(() => normalizePrivateKey("   ", "KEY")).toThrow(/not set/);
  });

  it("rejects non-hex characters", () => {
    expect(() => normalizePrivateKey("z".repeat(64), "KEY")).toThrow(PrivateKeyFormatError);
  });
});

describe("isValidPrivateKey", () => {
  it("reports validity without throwing", () => {
    expect(isValidPrivateKey(BODY)).toBe(true);
    expect(isValidPrivateKey(`0x${BODY}`)).toBe(true);
    expect(isValidPrivateKey("nope")).toBe(false);
    expect(isValidPrivateKey(undefined)).toBe(false);
  });
});
