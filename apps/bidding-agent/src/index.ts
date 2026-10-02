/**
 * `cca-agent` - watches one Uniswap CCA auction and bids when the clearing
 * price comes within a configured band of the operator's price cap.
 *
 *   cca-agent init              guided setup, writes .env here
 *   cca-agent status            live auction card
 *   cca-agent simulate          drive the real strategy through a price walk
 *   cca-agent plan              build the real bid transactions, never send
 *   cca-agent run               watch and decide, send nothing
 *   cca-agent run --live        watch and really bid
 *   cca-agent settle            exit bids and claim tokens (dry run; --live sends)
 *
 * Testnets and mainnets. A mainnet broadcast is locked until the operator
 * opts in (--mainnet / AGENT_ALLOW_MAINNET=true) and then types the network
 * name to confirm. A hard max-spend cap always applies, and the private key is
 * never logged - only the address derived from it.
 */
import * as p from "@clack/prompts";
import { createRequire } from "node:module";
import { isAddress } from "viem";
import type { Address } from "viem";
import {
  assertChainMatches,
  createBeaconClient,
  formatQ96,
  formatTokenAmount,
  rpcSettingsFromEnv,
} from "@hammerock/cca-sdk";
import { buildPlanForInspection, describeStrategy, loadContext, tick } from "./agent";
import { ConfigError, isMainnetChain, loadConfig, loadEnvFile } from "./config";
import { GuardError, assertChainAllowed } from "./guards";
import { runInit } from "./init";
import { runSettle } from "./settle";
import { CMD } from "./invocation";
import { runSimulation } from "./simulate";
import type { StrategyState } from "./strategy";
import { BRAND, auctionCard, cycleLine, info, pc, shortAddress } from "./ui";
import { readAuctionView } from "./view";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const COMMANDS = ["init", "status", "simulate", "plan", "run", "settle", "help"] as const;
type Command = (typeof COMMANDS)[number];

const HELP = `
${BRAND} ${pc.dim(`v${version}`)}

${pc.bold("Usage")}
  ${CMD} <command> [options]

${pc.bold("Commands")}
  ${pc.cyan("init")}       Guided setup - writes a .env in this folder
  ${pc.cyan("status")}     Show the auction's live state
  ${pc.cyan("simulate")}   Run your strategy through a scripted price walk
  ${pc.cyan("plan")}       Build the real bid transactions and print them
  ${pc.cyan("run")}        Watch the auction and decide - sends nothing
  ${pc.cyan("run --live")} Watch the auction and really bid
  ${pc.cyan("settle")}     Exit your bids and claim tokens - dry run; ${pc.cyan("--live")} sends

${pc.bold("Options")}
  --env <path>       Use this .env instead of ./.env
  --auction <addr>   Override AGENT_AUCTION_ADDRESS (status, settle)
  --owner <addr>     Whose bids to settle (settle; default: your key's address)
  --bid <ids>        Settle only these bid ids, e.g. 3,7 (settle)
  --once             One decision, then exit (run)
  --mainnet          Allow live bidding or settling on a mainnet (real money)
  --yes              Skip the confirmation before live bidding
  -v, --version      Print the version

${pc.bold("Your private key")}
  Read only from AGENT_PRIVATE_KEY (in .env or your shell). It never leaves
  this machine and is never printed - only the wallet address is.

${pc.bold("Networks")}
  Testnets  Sepolia, Base Sepolia, Unichain Sepolia
  Mainnets  Ethereum, Base, Unichain, Arbitrum ${pc.yellow("- real money")}
  Reading a mainnet needs nothing. Live bidding there needs ${pc.cyan("--mainnet")}
  (or AGENT_ALLOW_MAINNET=true) and you typing the network name to confirm.
`;

interface Args {
  command: Command;
  flags: string[];
  envPath?: string;
  auction?: string;
  owner?: string;
  bidIds?: string;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const flags: string[] = [];
  let command: Command | undefined;
  let envPath: string | undefined;
  let auction: string | undefined;
  let owner: string | undefined;
  let bidIds: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--env") envPath = argv[++i];
    else if (arg === "--auction") auction = argv[++i];
    else if (arg === "--owner") owner = argv[++i];
    else if (arg === "--bid") bidIds = argv[++i];
    else if (arg === "-h" || arg === "--help") command = "help";
    else if (arg.startsWith("-")) flags.push(arg);
    else if (!command) {
      if (!(COMMANDS as readonly string[]).includes(arg)) {
        throw new ConfigError(`Unknown command "${arg}". Run "${CMD} help".`);
      }
      command = arg as Command;
    }
  }

  // The pre-CLI flag forms (`--simulate`, `--plan`) still work on their own.
  if (!command) {
    if (flags.includes("--simulate")) command = "simulate";
    else if (flags.includes("--plan")) command = "plan";
    else if (flags.length > 0) command = "run";
    else command = "help";
  }
  if (command === "simulate") flags.push("--simulate");
  if (command === "plan") flags.push("--plan");

  return { command, flags, envPath, auction, owner, bidIds, yes: flags.includes("--yes") };
}

async function status(args: Args): Promise<void> {
  const auction = args.auction ?? process.env.AGENT_AUCTION_ADDRESS;
  if (!auction || !isAddress(auction)) {
    throw new ConfigError(`No auction. Pass --auction 0x… or run "${CMD} init".`);
  }
  const chainId = Number(process.env.BEACON_CHAIN_ID ?? 11155111);
  const client = createBeaconClient({ chainId, ...rpcSettingsFromEnv(chainId) });
  p.intro(BRAND);
  const spin = p.spinner();
  spin.start("Reading the auction");
  await assertChainMatches(client);
  const view = await readAuctionView(client, auction as Address);
  spin.stop("Live state");
  p.note(auctionCard(view), "Auction");
  p.outro(pc.dim(`block ${view.headBlock}`));
}

async function agent(args: Args): Promise<void> {
  const config = loadConfig(args.flags);
  const client = createBeaconClient({
    rpcUrl: config.rpcUrl,
    fallbackRpcUrls: config.fallbackRpcUrls,
    chainId: config.chainId,
    lensAddress: config.lensAddress,
  });

  p.intro(BRAND);
  const spin = p.spinner();
  spin.start("Checking network and auction");
  // Fails closed on an unknown chain, and on a mainnet broadcast without the
  // opt-in - checked against the id the RPC actually reports.
  await assertChainAllowed(client, config);
  await assertChainMatches(client);
  const [context, view] = await Promise.all([
    loadContext(client, config),
    readAuctionView(client, config.auction),
  ]);
  const mainnet = isMainnetChain(config.chainId);
  spin.stop(`Connected to ${client.chain.name}${mainnet ? pc.yellow("  (mainnet - real money)") : ""}`);

  p.note(auctionCard(view), "Auction");
  p.note(describeStrategy(context).replace(/\n {2}/g, "\n"), "Strategy");

  if (config.simulate) {
    p.log.step("Simulating a price walk through the real strategy");
    const result = runSimulation(
      config.strategy,
      context.info.floorPriceQ96,
      context.currency,
      (message) => console.log(pc.dim("│ ") + message),
    );
    p.outro(
      `${result.bids} bid(s), ${formatTokenAmount(result.spent, context.currency)} committed of ` +
        `${formatTokenAmount(config.strategy.maxSpend, context.currency)} budget`,
    );
    return;
  }

  if (config.plan) {
    const { steps, isNative, readiness, prevTickPriceQ96 } = await buildPlanForInspection(context);
    const lines = [
      `${isNative ? "Native currency" : "ERC-20 currency"} -> ${steps.length} transaction(s)`,
      `tick hint ${formatQ96(prevTickPriceQ96)}`,
    ];
    if (!isNative) {
      lines.push(
        `ERC-20 -> Permit2 approval ${readiness.needsErc20Approval ? "needed" : "done"}, ` +
          `Permit2 -> auction ${readiness.needsPermit2Approval ? "needed" : "done"}`,
      );
    }
    for (const [index, step] of steps.entries()) {
      lines.push(
        "",
        `${pc.bold(`${index + 1}. ${step.label}`)}`,
        `   to    ${step.to}`,
        `   value ${step.value}`,
        `   data  ${step.data.slice(0, 10)}… ${pc.dim(`${(step.data.length - 2) / 2} bytes`)}`,
      );
    }
    p.note(lines.join("\n"), "Plan - never sent");
    p.outro("Nothing was broadcast.");
    return;
  }

  const wallet = config.account?.address;
  if (config.broadcast) {
    const budget = formatTokenAmount(config.strategy.maxSpend, context.currency);
    if (mainnet) {
      p.log.error(
        `${pc.bold(`MAINNET - ${client.chain.name.toUpperCase()}`)}: these bids spend REAL money.\n` +
          `Wallet ${pc.bold(wallet!)}\n` +
          `Up to ${pc.bold(budget)} plus gas, at no more than ${config.strategy.maxPriceInput} per token.\n` +
          `Bids stay locked in the auction until they are settled. Afterwards, run\n` +
          `${CMD} settle to collect refunds and tokens.`,
      );
    } else {
      p.log.warn(`${pc.bold("LIVE")} - real transactions from ${pc.bold(shortAddress(wallet!))}, up to ${budget} plus gas.`);
    }
    if (!args.yes) {
      if (!process.stdin.isTTY) {
        throw new ConfigError("Live mode needs confirmation. Re-run with --yes to confirm non-interactively.");
      }
      if (mainnet) {
        // Typing the network name, not pressing y: a reflexive Enter must not
        // be able to start spending real money.
        const expected = client.chain.name.toLowerCase();
        const typed = await p.text({
          message: `Type ${pc.bold(expected)} to start live bidding on mainnet`,
          validate: (v) => ((v ?? "").trim().toLowerCase() === expected ? undefined : `Type "${expected}" exactly, or Ctrl+C`),
        });
        if (p.isCancel(typed)) {
          p.cancel("Stopped - nothing was sent.");
          return;
        }
      } else {
        const ok = await p.confirm({ message: "Start live bidding?", initialValue: false });
        if (p.isCancel(ok) || !ok) {
          p.cancel("Stopped - nothing was sent.");
          return;
        }
      }
    }
  } else {
    p.log.info(`${pc.bold("Dry run")} - decides for real, sends nothing. Add ${pc.cyan("--live")} to bid.`);
  }

  let state: StrategyState = { spent: 0n, bidsPlaced: 0 };
  const explorer = client.chain.blockExplorers?.default?.url;

  async function cycle(): Promise<boolean> {
    const result = await tick(context, state, { onLog: (m) => info(pc.dim(m)) });
    state = result.state;

    console.log(
      cycleLine({
        status: result.market.status,
        priceQ96: result.market.clearingPriceQ96,
        action: result.decision.action,
        reason: result.decision.reason,
      }),
    );

    if (result.plan && !result.hashes) {
      for (const step of result.plan) info(pc.dim(`  would send: ${step.label} -> ${step.to}`));
    }
    for (const hash of result.hashes ?? []) {
      info(`  ${pc.green("sent")} ${explorer ? `${explorer}/tx/${hash}` : hash}`);
    }
    if (result.decision.action === "bid") {
      info(
        `  ${formatTokenAmount(state.spent, context.currency)} of ` +
          `${formatTokenAmount(config.strategy.maxSpend, context.currency)} used, ` +
          `${state.bidsPlaced}/${config.strategy.maxBids} bids`,
      );
    }

    // Nothing further can happen once the auction closes or the caps are hit.
    return (
      result.market.status !== "ended" &&
      state.bidsPlaced < config.strategy.maxBids &&
      config.strategy.maxSpend - state.spent >= config.strategy.bidAmount
    );
  }

  if (config.once) {
    await cycle();
    p.outro("Done (--once).");
    return;
  }

  process.once("SIGINT", () => {
    console.log();
    p.outro("Stopped.");
    process.exit(0);
  });

  p.log.step(`Polling every ${config.pollIntervalMs / 1000}s ${pc.dim("- Ctrl+C to stop")}`);
  for (;;) {
    let shouldContinue: boolean;
    try {
      shouldContinue = await cycle();
    } catch (error) {
      if (error instanceof GuardError) throw error; // safety failures must stop the agent
      info(pc.red(`cycle failed: ${(error as Error).message.split("\n")[0]}`));
      shouldContinue = true;
    }

    if (!shouldContinue) {
      p.log.info(`When the auction ends, run ${pc.cyan(`${CMD} settle`)} to collect refunds and tokens.`);
      p.outro("Nothing further to do - stopped.");
      return;
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(version);
    return;
  }
  const args = parseArgs(argv);

  if (args.command === "help") {
    console.log(HELP);
    return;
  }
  if (args.command === "init") {
    await runInit({ envPath: args.envPath });
    return;
  }

  loadEnvFile(args.envPath);
  if (args.command === "status") await status(args);
  else if (args.command === "settle") await runSettle(args);
  else await agent(args);
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    console.error(`\n${pc.red("Configuration error")}\n  ${error.message}\n`);
  } else if (error instanceof GuardError) {
    console.error(`\n${pc.bgRed(pc.white(" SAFETY GUARD "))} ${error.message}\n`);
  } else {
    console.error(`\n${pc.red("Error")} ${(error as Error).message.split("\n")[0]}\n`);
  }
  // Exit explicitly: an error thrown while a spinner is running leaves its
  // timer alive, and the process would otherwise hang after printing - a
  // frozen terminal in place of the safety message.
  process.exit(1);
});
