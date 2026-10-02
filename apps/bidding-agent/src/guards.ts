/**
 * Pre-flight safety checks.
 *
 * These run before the agent is allowed to broadcast anything, and each one
 * fails closed. Chains are explicit allowlists (see config.ts): an unknown id
 * is refused by omission, and a mainnet only broadcasts after an opt-in.
 */
import { MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS } from "./config";
import type { AgentConfig } from "./config";
import type { BeaconClient } from "@hammerock/cca-sdk";

export class GuardError extends Error {}

/**
 * Refuse an unknown chain, and refuse to broadcast on a mainnet without the
 * operator's explicit opt-in.
 *
 * Checked against the id the RPC actually reports, not just the configured
 * one: a copy-pasted mainnet RPC URL behind a testnet BEACON_CHAIN_ID would
 * otherwise sail straight past the mainnet lock.
 */
export async function assertChainAllowed(client: BeaconClient, config: AgentConfig): Promise<void> {
  const known = (id: number) => TESTNET_CHAIN_IDS.has(id) || MAINNET_CHAIN_IDS.has(id);
  if (!known(config.chainId)) {
    throw new GuardError(`Refusing to run against unknown chain id ${config.chainId}.`);
  }

  const reported = await client.publicClient.getChainId();
  if (reported !== config.chainId) {
    throw new GuardError(
      `RPC chain id mismatch: configured ${config.chainId}, endpoint reports ${reported}. ` +
        `Refusing to run against an unexpected network.`,
    );
  }

  if (MAINNET_CHAIN_IDS.has(reported) && config.broadcast && !config.allowMainnet) {
    throw new GuardError(
      `MAINNET LOCKED: chain ${reported} spends real money. ` +
        `Pass --mainnet or set AGENT_ALLOW_MAINNET=true to broadcast.`,
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
