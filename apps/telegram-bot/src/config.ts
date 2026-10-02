/**
 * Environment parsing and validation for the alert bot.
 *
 * Fails fast with an actionable message rather than starting up and silently
 * never alerting.
 */
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decimalToQ96, NETWORKS, networkBySlug, networkFor, rpcSettingsFromEnv } from "@hammerock/cca-sdk";
import type { NetworkDefaults, RpcSettings } from "@hammerock/cca-sdk";
import type { Address } from "viem";
import { isAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
loadEnv({ path: resolve(repoRoot, ".env"), quiet: true });

/** One chain the bot watches: its RPC settings and its shared auction store. */
export interface BotChain {
  network: NetworkDefaults;
  rpc: RpcSettings;
  /** Shared auction catalogue, written by `pnpm sync:auctions`. */
  storePath: string;
}

export interface BotConfig {
  /** Every chain this one bot process watches. One token, one process. */
  chains: BotChain[];
  lensAddress?: Address;
  /** Where per-chat /watch registrations are persisted. */
  subscriptionsPath: string;
  /**
   * DEV/TESTING FALLBACK ONLY. Seeds the default chat's subscriptions at
   * startup. Real usage is the `/watch` command, which is per chat and
   * persists on its own.
   */
  watchAuctions: Address[];
  pollIntervalMs: number;
  telegram: {
    botToken?: string;
    chatId?: string;
  };
  thresholds: {
    priceAboveQ96?: bigint;
    priceBelowQ96?: bigint;
    /** Alert when a live auction has fewer than this many minutes left. */
    minutesLeft?: number;
  };
  /** Render alerts to stdout instead of sending them. */
  dryRun: boolean;
  /** Evaluate once and exit, instead of polling forever. */
  once: boolean;
  /** Push a scripted sequence of state changes through the real alert pipeline. */
  simulate: boolean;
}

function parseAddressList(raw: string | undefined, label: string): Address[] {
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^0x0{40}$/i.test(part));

  for (const part of parts) {
    if (!isAddress(part)) {
      throw new Error(`${label}: "${part}" is not a valid address.`);
    }
  }
  return parts as Address[];
}

function parsePriceThreshold(raw: string | undefined, label: string): bigint | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  try {
    return decimalToQ96(raw.trim());
  } catch {
    throw new Error(`${label}: "${raw}" is not a decimal price (e.g. 0.0001).`);
  }
}

function parseNumber(raw: string | undefined, fallback: number, label: string): number {
  if (!raw || raw.trim().length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}: "${raw}" is not a positive number.`);
  }
  return value;
}

/**
 * BEACON_BOT_CHAINS: comma-separated slugs or ids. Default: the four mainnets
 * plus Sepolia - the same set the directory lists.
 */
function parseChains(raw: string | undefined): NetworkDefaults[] {
  if (!raw?.trim()) {
    return Object.values(NETWORKS).filter((n) => !n.testnet || n.slug === "sepolia");
  }
  return raw.split(",").map((part) => {
    const network = networkBySlug(part.trim()) ?? networkFor(Number(part.trim()));
    if (!network) throw new Error(`BEACON_BOT_CHAINS: unknown chain "${part.trim()}".`);
    return network;
  });
}

export function loadConfig(argv: readonly string[] = process.argv.slice(2)): BotConfig {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const lens = process.env.BEACON_LENS_ADDRESS?.trim();
  const dataDir = resolve(repoRoot, process.env.BEACON_DATA_DIR ?? "data");

  const config: BotConfig = {
    chains: parseChains(process.env.BEACON_BOT_CHAINS).map((network) => ({
      network,
      rpc: rpcSettingsFromEnv(network.chainId),
      storePath: resolve(dataDir, `auctions.${network.slug}.json`),
    })),
    subscriptionsPath: resolve(
      repoRoot,
      process.env.BEACON_SUBSCRIPTIONS_PATH ?? "data/telegram-subscriptions.json",
    ),
    // Empty is correct and supported: reads then run through an eth_call state
    // override, so the bot works with no lens deployment at all.
    lensAddress: lens && lens.length > 0 && isAddress(lens) ? (lens as Address) : undefined,
    watchAuctions: parseAddressList(
      process.env.BEACON_WATCH_AUCTION_ADDRESS,
      "BEACON_WATCH_AUCTION_ADDRESS",
    ),
    pollIntervalMs: parseNumber(
      process.env.BEACON_POLL_INTERVAL_SECONDS,
      15,
      "BEACON_POLL_INTERVAL_SECONDS",
    ) * 1000,
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
      chatId: process.env.TELEGRAM_CHAT_ID?.trim() || undefined,
    },
    thresholds: {
      priceAboveQ96: parsePriceThreshold(
        process.env.BEACON_ALERT_PRICE_ABOVE,
        "BEACON_ALERT_PRICE_ABOVE",
      ),
      priceBelowQ96: parsePriceThreshold(
        process.env.BEACON_ALERT_PRICE_BELOW,
        "BEACON_ALERT_PRICE_BELOW",
      ),
      minutesLeft: process.env.BEACON_ALERT_MINUTES_LEFT
        ? parseNumber(process.env.BEACON_ALERT_MINUTES_LEFT, 15, "BEACON_ALERT_MINUTES_LEFT")
        : 15,
    },
    dryRun: flags.has("--dry-run"),
    once: flags.has("--once"),
    simulate: flags.has("--simulate"),
  };

  if (!config.dryRun) {
    const missing: string[] = [];
    if (!config.telegram.botToken) missing.push("TELEGRAM_BOT_TOKEN");
    if (!config.telegram.chatId) missing.push("TELEGRAM_CHAT_ID");
    if (missing.length > 0) {
      throw new Error(
        `Missing ${missing.join(" and ")} in .env.\n` +
          `Get a token from @BotFather, then set TELEGRAM_CHAT_ID to the channel or DM id.\n` +
          `Or run with --dry-run to print alerts to the console instead of sending them.`,
      );
    }
  }

  return config;
}
