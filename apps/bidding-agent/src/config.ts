/**
 * Agent configuration.
 *
 * SAFETY. This is the only file that touches the private key. It is read from
 * the environment, never from an argument or a file the agent writes, and only
 * the DERIVED ADDRESS is ever exposed to the rest of the program. `BotConfig`
 * deliberately carries an `account`, not a key, so no later code can log it by
 * accident.
 */
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { isAddress } from "viem";
import type { Address, PrivateKeyAccount } from "viem";
import { decimalToQ96 } from "@beacon/cca-sdk";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
loadEnv({ path: resolve(repoRoot, ".env"), quiet: true });

/**
 * Chains the agent may EVER broadcast on.
 *
 * Deliberately narrower than the SDK's supported-chain list, and mainnet ids
 * are simply absent, so an unknown chain fails closed. Overridable only by an
 * explicit env var that still has to name a testnet.
 */
export const ALLOWED_CHAIN_IDS = new Set<number>([
  11155111, // Ethereum Sepolia
  84532, // Base Sepolia
  1301, // Unichain Sepolia
]);

export interface AgentConfig {
  rpcUrl: string;
  chainId: number;
  lensAddress?: Address;
  auction: Address;

  /** Derived from AGENT_PRIVATE_KEY. The key itself is never stored here. */
  account?: PrivateKeyAccount;

  strategy: {
    /** Hard price cap, Q96. Truncated DOWN from the configured decimal. */
    maxPriceQ96: bigint;
    /** The decimal the user actually typed, for reporting. */
    maxPriceInput: string;
    /** Per-bid size, in the currency's smallest unit. */
    bidAmount: bigint;
    /** Bid when the clearing price comes within this many basis points of the cap. */
    triggerBps: number;
    /** Hard cap on total spend across the whole run, in the currency's smallest unit. */
    maxSpend: bigint;
    /** Stop bidding once this many bids have been placed. */
    maxBids: number;
  };

  pollIntervalMs: number;
  /** True only when AGENT_BROADCAST=true AND --dry-run was not passed. */
  broadcast: boolean;
  /** Run a scripted scenario through the real strategy instead of polling. */
  simulate: boolean;
  /** Build and print the bid transactions without the lifecycle gate. Never sends. */
  plan: boolean;
  once: boolean;
}

export class ConfigError extends Error {}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new ConfigError(`${name} is not set in .env`);
  }
  return value.trim();
}

function parseBigint(name: string, raw: string | undefined, fallback?: bigint): bigint {
  if (!raw || raw.trim().length === 0) {
    if (fallback !== undefined) return fallback;
    throw new ConfigError(`${name} is not set in .env`);
  }
  let value: bigint;
  try {
    value = BigInt(raw.trim());
  } catch {
    throw new ConfigError(`${name}: "${raw}" is not an integer (expected base units, e.g. wei).`);
  }
  if (value <= 0n) throw new ConfigError(`${name} must be positive, got ${value}.`);
  return value;
}

function parseNumber(name: string, raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${name}: "${raw}" is not a non-negative number.`);
  }
  return value;
}

/**
 * Load and validate the private key.
 *
 * Accepts it ONLY from the environment. Returns an account, so callers get an
 * address and a signer without ever seeing the key material.
 */
function loadAccount(broadcast: boolean): PrivateKeyAccount | undefined {
  const raw = process.env.AGENT_PRIVATE_KEY?.trim();

  if (!raw || raw.length === 0 || /^0x0{64}$/i.test(raw)) {
    if (broadcast) {
      throw new ConfigError(
        "AGENT_PRIVATE_KEY is not set, but AGENT_BROADCAST=true.\n" +
          "Use a throwaway TESTNET key. Never a mainnet key. Never commit it.",
      );
    }
    return undefined;
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    // Deliberately does not echo the value.
    throw new ConfigError(
      "AGENT_PRIVATE_KEY is malformed: expected 0x followed by 64 hex characters.",
    );
  }

  return privateKeyToAccount(raw as `0x${string}`);
}

export function loadConfig(argv: readonly string[] = process.argv.slice(2)): AgentConfig {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));

  const chainId = Number(process.env.BEACON_CHAIN_ID ?? 11155111);
  const auction = required("AGENT_AUCTION_ADDRESS", process.env.AGENT_AUCTION_ADDRESS);
  if (!isAddress(auction)) {
    throw new ConfigError(`AGENT_AUCTION_ADDRESS: "${auction}" is not a valid address.`);
  }

  const maxPriceInput = required("AGENT_MAX_PRICE", process.env.AGENT_MAX_PRICE);
  let maxPriceQ96: bigint;
  try {
    // decimalToQ96 truncates DOWN, so the effective cap is never above what the
    // operator typed. That is the safe direction for a price ceiling.
    maxPriceQ96 = decimalToQ96(maxPriceInput);
  } catch {
    throw new ConfigError(`AGENT_MAX_PRICE: "${maxPriceInput}" is not a decimal price.`);
  }
  if (maxPriceQ96 <= 0n) throw new ConfigError("AGENT_MAX_PRICE must be greater than zero.");

  // --dry-run always wins over AGENT_BROADCAST.
  const wantsBroadcast =
    (process.env.AGENT_BROADCAST ?? "false").trim().toLowerCase() === "true" &&
    !flags.has("--dry-run") &&
    // --plan bypasses the lifecycle gate, so it is never allowed to send.
    !flags.has("--plan");

  const lens = process.env.BEACON_LENS_ADDRESS?.trim();

  const bidAmount = parseBigint("AGENT_BID_AMOUNT_WEI", process.env.AGENT_BID_AMOUNT_WEI);
  const maxSpend = parseBigint("AGENT_MAX_SPEND_WEI", process.env.AGENT_MAX_SPEND_WEI);

  if (bidAmount > maxSpend) {
    throw new ConfigError(
      `AGENT_BID_AMOUNT_WEI (${bidAmount}) exceeds AGENT_MAX_SPEND_WEI (${maxSpend}) - ` +
        `the agent could never place even one bid.`,
    );
  }

  const triggerPercent = parseNumber("AGENT_TRIGGER_PERCENT", process.env.AGENT_TRIGGER_PERCENT, 10);
  if (triggerPercent > 100) {
    throw new ConfigError(`AGENT_TRIGGER_PERCENT must be between 0 and 100, got ${triggerPercent}.`);
  }

  return {
    rpcUrl: process.env.BEACON_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    chainId,
    lensAddress: lens && lens.length > 0 && isAddress(lens) ? (lens as Address) : undefined,
    auction: auction as Address,
    account: loadAccount(wantsBroadcast),
    strategy: {
      maxPriceQ96,
      maxPriceInput,
      bidAmount,
      // Basis points keeps the comparison in integer space alongside Q96.
      triggerBps: Math.round(triggerPercent * 100),
      maxSpend,
      maxBids: Math.max(1, Math.floor(parseNumber("AGENT_MAX_BIDS", process.env.AGENT_MAX_BIDS, 3))),
    },
    pollIntervalMs:
      parseNumber("BEACON_POLL_INTERVAL_SECONDS", process.env.BEACON_POLL_INTERVAL_SECONDS, 15) *
      1000,
    broadcast: wantsBroadcast,
    simulate: flags.has("--simulate"),
    plan: flags.has("--plan"),
    once: flags.has("--once"),
  };
}
