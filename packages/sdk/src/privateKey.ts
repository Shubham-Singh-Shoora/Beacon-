/**
 * Private-key format normalisation.
 *
 * This module does exactly one thing: turn a key string into the `0x`-prefixed
 * form viem requires, or throw. It never logs, never stores, and never returns
 * anything derived from the key other than the key itself.
 *
 * It exists because wallets and key exporters disagree about the `0x` prefix -
 * Foundry's `cast wallet new` prints one, several UIs do not - and bouncing a
 * user back to edit their `.env` over two characters is a poor trade for the
 * risk of them pasting the key somewhere less safe while they fix it.
 */

/** A 32-byte private key in the form viem expects. */
export type PrivateKeyHex = `0x${string}`;

export class PrivateKeyFormatError extends Error {}

/**
 * Normalise a private key to `0x` + 64 hex characters.
 *
 * Accepts the key with or without the prefix. Every error message here is
 * deliberately written to describe the SHAPE of the problem and never to echo
 * any part of the value.
 *
 * @throws PrivateKeyFormatError when the value is not a 32-byte hex key.
 */
export function normalizePrivateKey(raw: string | undefined, envVarName: string): PrivateKeyHex {
  const trimmed = (raw ?? "").trim();

  if (trimmed.length === 0) {
    throw new PrivateKeyFormatError(`${envVarName} is not set.`);
  }

  const body = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;

  if (!/^[0-9a-fA-F]{64}$/.test(body)) {
    throw new PrivateKeyFormatError(
      `${envVarName} is malformed: expected 64 hex characters (optionally 0x-prefixed), ` +
        `got ${body.length} characters. The value itself is not shown.`,
    );
  }

  if (/^0{64}$/.test(body)) {
    throw new PrivateKeyFormatError(
      `${envVarName} is all zeros - that is the .env.example placeholder, not a real key.`,
    );
  }

  return `0x${body.toLowerCase()}` as PrivateKeyHex;
}

/** True when a key is present and well-formed, without throwing. */
export function isValidPrivateKey(raw: string | undefined): boolean {
  try {
    normalizePrivateKey(raw, "key");
    return true;
  } catch {
    return false;
  }
}
