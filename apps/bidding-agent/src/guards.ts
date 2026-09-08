/**
 * Pre-flight safety checks.
 *
 * These run before the agent is allowed to broadcast anything, and each one
 * fails closed. The agent is testnet-only by construction: mainnet chain ids
 * are absent from the allowlist rather than blocked by a condition someone
 * could invert.
 */
import { ALLOWED_CHAIN_IDS } from "./config";
import type { AgentConfig } from "./config";
import type { BeaconClient } from "@beacon/cca-sdk";

export class GuardError extends Error {}

/**
 * Refuse any chain that is not an explicitly allowed testnet.
 *
 * Checked twice on purpose: once against the configured id, and once against
 * the id the RPC actually reports, because a copy-pasted mainnet RPC URL with a
 * testnet chain id in .env would otherwise sail straight through.
 */
export async function assertTestnetOnly(
  client: BeaconClient,
  config: AgentConfig,
): Promise<void> {
  if (!ALLOWED_CHAIN_IDS.has(config.chainId)) {
    throw new GuardError(
      `TESTNET ONLY: refusing to run against chain id ${config.chainId}. ` +
        `Allowed: ${[...ALLOWED_CHAIN_IDS].join(", ")}.`,
    );
  }

  const reported = await client.publicClient.getChainId();
  if (reported !== config.chainId) {
    throw new GuardError(
      `RPC chain id mismatch: configured ${config.chainId}, endpoint reports ${reported}. ` +
        `Refusing to broadcast against an unexpected network.`,
    );
  }
  if (!ALLOWED_CHAIN_IDS.has(reported)) {
    throw new GuardError(
      `TESTNET ONLY: the RPC endpoint reports chain id ${reported}, which is not allowed.`,
    );
  }
}

/**
 * The spend ceiling, enforced immediately before a transaction is sent.
 *
 * The strategy already refuses to exceed the cap, but this is the last line of
 * defence: if a bug ever let a decision through, this still stops the send.
 */
export function assertWithinSpendCap(input: {
  spent: bigint;
  amount: bigint;
  maxSpend: bigint;
}): void {
  const projected = input.spent + input.amount;
  if (projected > input.maxSpend) {
    throw new GuardError(
      `MAX SPEND EXCEEDED: this bid would bring total spend to ${projected}, ` +
        `over the cap of ${input.maxSpend}. Refusing to send.`,
    );
  }
}

/** Refuse to bid above the configured ceiling, whatever the caller passed. */
export function assertWithinPriceCap(input: {
  maxPriceQ96: bigint;
  submittedPriceQ96: bigint;
}): void {
  if (input.submittedPriceQ96 > input.maxPriceQ96) {
    throw new GuardError(
      `PRICE CAP EXCEEDED: refusing to submit a bid at ${input.submittedPriceQ96} ` +
        `when the configured cap is ${input.maxPriceQ96}.`,
    );
  }
}

/** Confirm the wallet can actually cover the bid before broadcasting. */
export function assertSufficientBalance(input: {
  balance: bigint;
  amount: bigint;
  symbol: string;
}): void {
  if (input.balance < input.amount) {
    throw new GuardError(
      `Insufficient ${input.symbol}: hold ${input.balance}, bid needs ${input.amount}.`,
    );
  }
}
