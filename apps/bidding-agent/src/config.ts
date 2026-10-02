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
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { isAddress } from "viem";
import type { Address, PrivateKeyAccount } from "viem";
import { decimalToQ96, normalizePrivateKey, PrivateKeyFormatError, rpcSettingsFromEnv } from "@hammerock/cca-sdk";
import { CMD } from "./invocation";

/**
 * Load the operator's `.env`.
 *
 * Only ever the file named by `--env`, or `.env` in the directory the command
 * was run from. Installed as a package, the agent must never walk up into some
 * unrelated project's `.env`. Variables already set in the shell win.
 * Returns the path that was loaded, if any.
 */
export function loadEnvFile(explicitPath?: string): string | undefined {
  const path = resolve(explicitPath ?? ".env");
  if (!existsSync(path)) {
    if (explicitPath) throw new ConfigError(`--env file not found: ${path}`);
    return undefined;
  }
  loadEnv({ path, quiet: true });
  return path;
}

/**
 * Testnets: the agent may read and broadcast freely.
 *
 * Both lists are written out here rather than taken from the SDK, so a chain
 * the SDK adds later is unknown to the agent - and refused - until it is
 * deliberately listed. An unknown chain fails closed by omission.
 */
export const TESTNET_CHAIN_IDS = new Set<number>([
  11155111, // Ethereum Sepolia
  84532, // Base Sepolia
  1301, // Unichain Sepolia
]);

/**
 * Mainnets: real money. Reading and dry runs are always fine; broadcasting
 * additionally needs `--mainnet` or `AGENT_ALLOW_MAINNET=true`.
 */
export const MAINNET_CHAIN_IDS = new Set<number>([
  1, // Ethereum
  8453, // Base
  130, // Unichain
  42161, // Arbitrum One
]);

export function isMainnetChain(chainId: number): boolean {
  return MAINNET_CHAIN_IDS.has(chainId);
}

export interface AgentConfig {
  rpcUrl: string;
  /** Tried in order when rpcUrl errors (BEACON_FALLBACK_RPC_URL_<id>). */
  fallbackRpcUrls: string[];
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
  /** True only when --live or AGENT_BROADCAST=true, AND neither --dry-run nor --plan was passed. */
  broadcast: boolean;
  /** The operator opted in to real-money broadcasting: --mainnet or AGENT_ALLOW_MAINNET=true. */
  allowMainnet: boolean;
  /** Run a scripted scenario through the real strategy instead of polling. */
  simulate: boolean;
  /** Build and print the bid transactions without the lifecycle gate. Never sends. */
  plan: boolean;
  once: boolean;
}

export class ConfigError extends Error {}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new ConfigError(`${name} is not set. Run "${CMD} init" to create a .env here.`);
  }
  return value.trim();
}

function parseBigint(name: string, raw: string | undefined, fallback?: bigint): bigint {
  if (!raw || raw.trim().length === 0) {
    if (fallback !== undefined) return fallback;
    throw new ConfigError(`${name} is not set. Run "${CMD} init" to create a .env here.`);
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
export function loadAccount(broadcast: boolean): PrivateKeyAccount | undefined {
  const raw = process.env.AGENT_PRIVATE_KEY?.trim();

  if (!raw || raw.length === 0 || /^0x0{64}$/i.test(raw)) {
    if (broadcast) {
      throw new ConfigError(
        "Live mode needs AGENT_PRIVATE_KEY, and it is not set.\n" +
          "  Add it to your .env, or set it in this shell only:\n" +
          "    macOS/Linux:  export AGENT_PRIVATE_KEY=0x...\n" +
          "    PowerShell:   $env:AGENT_PRIVATE_KEY=\"0x...\"\n" +
          "  Use a dedicated wallet holding only your budget plus gas. Never commit it.",
      );
    }
    return undefined;
  }

  try {
    // Accepts the key with or without the 0x prefix. Errors describe the shape
    // of the problem and never echo the value.
    return privateKeyToAccount(normalizePrivateKey(raw, "AGENT_PRIVATE_KEY"));
  } catch (error) {
    if (error instanceof PrivateKeyFormatError) throw new ConfigError(error.message);
    throw error;
  }
}

function pickRpc(chainId: number): { rpcUrl: string; fallbackRpcUrls: string[] } {
  const { rpcUrl, fallbackRpcUrls } = rpcSettingsFromEnv(chainId);
  return { rpcUrl, fallbackRpcUrls };
}

export function loadConfig(argv: readonly string[] = process.argv.slice(2)): AgentConfig {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));

  const chainId = Number(process.env.BEACON_CHAIN_ID ?? 11155111);
  if (!TESTNET_CHAIN_IDS.has(chainId) && !MAINNET_CHAIN_IDS.has(chainId)) {
    throw new ConfigError(
      `BEACON_CHAIN_ID ${chainId} is not supported. ` +
        `Testnets: ${[...TESTNET_CHAIN_IDS].join(", ")}. Mainnets: ${[...MAINNET_CHAIN_IDS].join(", ")}.`,
    );
  }
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

  // --dry-run always wins over --live and AGENT_BROADCAST.
  const wantsBroadcast =
    (flags.has("--live") ||
      (process.env.AGENT_BROADCAST ?? "false").trim().toLowerCase() === "true") &&
    !flags.has("--dry-run") &&
    // --plan bypasses the lifecycle gate, so it is never allowed to send.
    !flags.has("--plan");

  const allowMainnet =
    flags.has("--mainnet") ||
    (process.env.AGENT_ALLOW_MAINNET ?? "false").trim().toLowerCase() === "true";

  // Checked here so the operator hears it before anything connects, and again
  // in guards.ts against the chain the RPC actually reports.
  if (wantsBroadcast && isMainnetChain(chainId) && !allowMainnet) {
    throw new ConfigError(
      `Chain ${chainId} is a MAINNET - live bids spend real money.\n` +
        "  Opt in explicitly: add --mainnet, or set AGENT_ALLOW_MAINNET=true.\n" +
        "  Dry runs, status, plan and simulate need no opt-in.",
    );
  }

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
    // BEACON_RPC_URL(_<id>), else the chain's free default; plus any fallbacks.
    ...pickRpc(chainId),
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
    allowMainnet,
    simulate: flags.has("--simulate"),
    plan: flags.has("--plan"),
    once: flags.has("--once"),
  };
}
