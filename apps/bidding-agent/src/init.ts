/**
 * `cca-agent init` - an interactive setup that writes a `.env` in the current
 * directory.
 *
 * It reads the auction first so every question can show the live numbers it
 * is about (clearing price, floor, currency), and it converts human amounts
 * ("0.01 ETH") to base units using the currency's real decimals.
 *
 * It never asks for the private key. Typing a key into a prompt that writes it
 * to disk is exactly the habit an operator should not learn; the summary tells
 * them where to put it instead.
 */
import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAddress, parseUnits } from "viem";
import type { Address } from "viem";
import { assertChainMatches, createBeaconClient, decimalToQ96, formatQ96 } from "@hammerock/cca-sdk";
import { MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS, isMainnetChain } from "./config";
import { BRAND, auctionCard, pc } from "./ui";
import { CMD } from "./invocation";
import { readAuctionView } from "./view";

/** Keyless public endpoints - fine to start with; a keyed RPC is more reliable. */
export const NETWORKS = [
  { id: 1, label: "Ethereum", rpc: "https://ethereum-rpc.publicnode.com" },
  { id: 8453, label: "Base", rpc: "https://mainnet.base.org" },
  { id: 130, label: "Unichain", rpc: "https://mainnet.unichain.org" },
  { id: 42161, label: "Arbitrum One", rpc: "https://arb1.arbitrum.io/rpc" },
  { id: 11155111, label: "Ethereum Sepolia", rpc: "https://ethereum-sepolia-rpc.publicnode.com" },
  { id: 84532, label: "Base Sepolia", rpc: "https://sepolia.base.org" },
  { id: 1301, label: "Unichain Sepolia", rpc: "https://sepolia.unichain.org" },
].filter((n) => MAINNET_CHAIN_IDS.has(n.id) || TESTNET_CHAIN_IDS.has(n.id));

/** Bail out cleanly on Ctrl+C at any prompt. */
function answer<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled - nothing was written.");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

function positiveDecimal(raw: string | undefined): string | undefined {
  const value = (raw ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(value)) return "Enter a number, e.g. 0.01";
  if (Number(value) <= 0) return "Must be greater than zero";
  return undefined;
}

export async function runInit(options: { envPath?: string }): Promise<void> {
  const target = resolve(options.envPath ?? ".env");
  p.intro(BRAND);

  if (existsSync(target)) {
    const overwrite = answer(
      await p.confirm({ message: `${target} already exists. Overwrite it?`, initialValue: false }),
    );
    if (!overwrite) {
      p.cancel("Kept your existing .env.");
      return;
    }
  }

  const chainId = answer(
    await p.select({
      message: "Which network is the auction on?",
      options: NETWORKS.map((n) => ({
        value: n.id,
        label: n.label,
        hint: isMainnetChain(n.id) ? "mainnet - real money" : "testnet",
      })),
    }),
  );
  const network = NETWORKS.find((n) => n.id === chainId)!;
  const mainnet = isMainnetChain(chainId);
  if (mainnet) {
    p.log.warn(
      `${network.label} is a mainnet - live bids spend real money. Everything else ` +
        `(status, simulate, run without --live) is read-only.`,
    );
  }

  const rpcUrl = answer(
    await p.text({
      message: "RPC URL",
      placeholder: network.rpc,
      defaultValue: network.rpc,
      validate: (v) => (!v || /^https?:\/\//.test(v.trim()) ? undefined : "Must start with http:// or https://"),
    }),
  ).trim();

  const auction = answer(
    await p.text({
      message: "Auction address",
      placeholder: "0x…",
      validate: (v) => (isAddress((v ?? "").trim()) ? undefined : "Not a valid address"),
    }),
  ).trim() as Address;

  const spin = p.spinner();
  spin.start("Reading the auction");
  let view;
  try {
    const client = createBeaconClient({ rpcUrl, chainId });
    await assertChainMatches(client);
    view = await readAuctionView(client, auction);
    spin.stop("Auction found");
  } catch (error) {
    spin.error("Could not read that auction");
    p.log.error((error as Error).message.split("\n")[0]!);
    p.outro("Check the address, network and RPC URL, then run init again.");
    process.exitCode = 1;
    return;
  }
  p.note(auctionCard(view), "Auction");
  if (view.status === "ended") {
    p.log.warn("This auction has ended. The agent will start, see that, and stop.");
  }

  const { currency, token } = view;
  const clearing = formatQ96(view.state.checkpoint.clearingPriceQ96);

  const maxPrice = answer(
    await p.text({
      message: `Highest price you will ever pay ${pc.dim(`(${currency.symbol} per ${token.symbol})`)}`,
      placeholder: `clearing is ${clearing} - your cap must be above it to fill`,
      validate: (v) => {
        const value = (v ?? "").trim();
        try {
          if (decimalToQ96(value) <= 0n) return "Must be greater than zero";
        } catch {
          return "Enter a decimal price, e.g. 0.0001";
        }
        return undefined;
      },
    }),
  ).trim();
  if (decimalToQ96(maxPrice) < view.info.floorPriceQ96) {
    p.log.warn(`That is below the floor price (${formatQ96(view.info.floorPriceQ96)}), so no bid can ever fill.`);
  }

  const bidSize = answer(
    await p.text({
      message: `Size of each bid ${pc.dim(`(in ${currency.symbol})`)}`,
      placeholder: "0.001",
      validate: positiveDecimal,
    }),
  ).trim();
  const bidWei = parseUnits(bidSize, currency.decimals);

  const budget = answer(
    await p.text({
      message: `Total budget - the agent never spends more ${pc.dim(`(in ${currency.symbol})`)}`,
      placeholder: bidSize,
      defaultValue: bidSize,
      validate: (v) => {
        const value = (v ?? "").trim() || bidSize;
        const error = positiveDecimal(value);
        if (error) return error;
        return parseUnits(value, currency.decimals) < bidWei ? "Budget must cover at least one bid" : undefined;
      },
    }),
  ).trim();
  const budgetWei = parseUnits(budget, currency.decimals);

  const trigger = answer(
    await p.text({
      message: "Start bidding when the price is within what % of your cap?",
      placeholder: "10",
      defaultValue: "10",
      validate: (v) => {
        const n = Number((v ?? "").trim() || "10");
        return Number.isFinite(n) && n >= 0 && n <= 100 ? undefined : "Enter 0 to 100";
      },
    }),
  ).trim();

  const maxBids = answer(
    await p.text({
      message: "Maximum number of bids",
      placeholder: "3",
      defaultValue: "3",
      validate: (v) => (/^[1-9]\d*$/.test((v ?? "").trim() || "3") ? undefined : "Enter a whole number, 1 or more"),
    }),
  ).trim();

  const env = [
    "# cca-agent configuration - written by `cca-agent init`.",
    "# Keep this file private. Add it to .gitignore.",
    "",
    `BEACON_CHAIN_ID=${chainId}`,
    `BEACON_RPC_URL=${rpcUrl}`,
    `AGENT_AUCTION_ADDRESS=${auction}`,
    "",
    `# Never bid above this price (${currency.symbol} per ${token.symbol}).`,
    `AGENT_MAX_PRICE=${maxPrice}`,
    `# ${bidSize} ${currency.symbol} per bid, ${budget} ${currency.symbol} total (base units).`,
    `AGENT_BID_AMOUNT_WEI=${bidWei}`,
    `AGENT_MAX_SPEND_WEI=${budgetWei}`,
    `AGENT_TRIGGER_PERCENT=${trigger}`,
    `AGENT_MAX_BIDS=${maxBids}`,
    "BEACON_POLL_INTERVAL_SECONDS=15",
    "",
    "# Only needed for `cca-agent run --live`. Use a dedicated wallet holding",
    "# no more than your budget plus gas. Never commit this.",
    "AGENT_PRIVATE_KEY=",
    ...(mainnet
      ? [
          "",
          "# MAINNET: live bidding stays locked until this is true (or you pass",
          "# --mainnet). Leave it false until a dry run looks right.",
          "AGENT_ALLOW_MAINNET=false",
        ]
      : []),
    "",
  ].join("\n");
  writeFileSync(target, env, { mode: 0o600 });

  const gitignore = resolve(".gitignore");
  if (existsSync(resolve(".git")) && !(existsSync(gitignore) && /^\.env$/m.test(readFileSync(gitignore, "utf8")))) {
    p.log.warn(`This is a git repo and .env is not in .gitignore. Add it before you put a key in.`);
  }

  const next: Array<[string, string]> = [
    ["status", "check the auction"],
    ["simulate", "see how your strategy behaves"],
    ["run", "watch and decide, sends nothing"],
    mainnet
      ? ["run --live --mainnet", `really bid ${pc.dim("(real money; needs AGENT_PRIVATE_KEY)")}`]
      : ["run --live", `really bid ${pc.dim("(needs AGENT_PRIVATE_KEY)")}`],
  ];
  const width = Math.max(...next.map(([command]) => command.length));
  p.note(
    next.map(([command, what]) => `${pc.cyan(`${CMD} ${command.padEnd(width)}`)}  ${what}`).join("\n"),
    "Next",
  );
  if (CMD !== "cca-agent") {
    p.log.info(`Tip: ${pc.cyan("npm i -g @hammerock/cca-agent")} once, then just type ${pc.cyan("cca-agent …")}`);
  }
  p.outro(`Saved ${pc.bold(target)}`);
}
