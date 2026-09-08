/**
 * Beacon bidding agent.
 *
 * Watches one CCA auction and submits a bid when the clearing price comes
 * within a configured band of the operator's price cap.
 *
 *   pnpm agent -- --dry-run     read real state, build real calldata, send nothing
 *   pnpm agent -- --simulate    drive the real strategy through a scripted price walk
 *   pnpm agent -- --once        one decision cycle, then exit
 *   pnpm agent                  poll and (if AGENT_BROADCAST=true) bid
 *
 * TESTNET ONLY. The agent refuses to run against any chain id outside an
 * explicit testnet allowlist, enforces a hard max-spend cap, and never logs the
 * private key - only the address derived from it.
 */
import { assertChainMatches, createBeaconClient, formatQ96, formatTokenAmount } from "@beacon/cca-sdk";
import { buildPlanForInspection, describeStrategy, loadContext, tick } from "./agent";
import { ConfigError, loadConfig } from "./config";
import { GuardError, assertTestnetOnly } from "./guards";
import { runSimulation } from "./simulate";
import type { StrategyState } from "./strategy";

function log(message = ""): void {
  console.log(message ? `[beacon-agent] ${message}` : "");
}

async function main(): Promise<void> {
  const config = loadConfig();

  log("=".repeat(60));
  log("TESTNET ONLY - this agent will not run against mainnet.");
  log("=".repeat(60));
  log(`chain    ${config.chainId}`);
  log(`auction  ${config.auction}`);
  // Only ever the derived address; the key itself is never printed.
  log(`wallet   ${config.account?.address ?? "none loaded (dry run)"}`);
  log(`mode     ${config.broadcast ? "BROADCAST - will send real transactions" : "DRY RUN - nothing will be sent"}`);

  const client = createBeaconClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    lensAddress: config.lensAddress,
  });

  // Fails closed on anything that is not an allowed testnet, checking both the
  // configured id and the id the RPC actually reports.
  await assertTestnetOnly(client, config);
  await assertChainMatches(client);
  log("chain guard passed");

  const context = await loadContext(client, config);
  log("");
  log(`strategy:\n  ${describeStrategy(context)}`);
  log("");

  if (config.simulate) {
    log("simulating a price walk through the real strategy...");
    log("");
    const result = runSimulation(
      config.strategy,
      context.info.floorPriceQ96,
      context.currency,
      (message) => console.log(message),
    );
    log("");
    log(
      `simulation complete: ${result.bids} bid(s), ${formatTokenAmount(result.spent, context.currency)} committed ` +
        `of ${formatTokenAmount(config.strategy.maxSpend, context.currency)} cap`,
    );
    return;
  }

  if (config.plan) {
    log("PLAN MODE - building the bid transactions, ignoring the auction lifecycle gate.");
    log("Nothing is broadcast in this mode, ever.");
    log("");
    const { steps, isNative, readiness, prevTickPriceQ96 } = await buildPlanForInspection(context);

    log(`currency is ${isNative ? "NATIVE" : "an ERC-20"} -> ${steps.length} transaction(s)`);
    log(`tick hint (prevTickPrice): ${prevTickPriceQ96} (${formatQ96(prevTickPriceQ96)})`);
    if (!isNative) {
      log(
        `permit2: erc20->permit2 approval needed=${readiness.needsErc20Approval}, ` +
          `permit2->auction approval needed=${readiness.needsPermit2Approval}`,
      );
    }
    log("");
    for (const [index, step] of steps.entries()) {
      log(`${index + 1}. ${step.label}`);
      log(`   to    ${step.to}`);
      log(`   value ${step.value}`);
      log(`   data  ${step.data.slice(0, 74)}...`);
      log(`   len   ${(step.data.length - 2) / 2} bytes, selector ${step.data.slice(0, 10)}`);
    }
    return;
  }

  let state: StrategyState = { spent: 0n, bidsPlaced: 0 };

  async function cycle(): Promise<boolean> {
    const result = await tick(context, state, { onLog: (m) => log(m) });
    state = result.state;

    log(
      `status=${result.market.status} price=${formatQ96(result.market.clearingPriceQ96)} ` +
        `-> ${result.decision.action.toUpperCase()}: ${result.decision.reason}`,
    );

    if (result.plan) {
      log(`plan (${result.plan.length} transaction(s)):`);
      for (const step of result.plan) {
        log(`  - ${step.label}`);
        log(`      to=${step.to} value=${step.value} data=${step.dataPreview}`);
      }
    }

    if (result.hashes) {
      for (const hash of result.hashes) {
        const explorer = client.chain.blockExplorers?.default?.url;
        log(`  sent ${hash}${explorer ? ` (${explorer}/tx/${hash})` : ""}`);
      }
    }

    if (result.decision.action === "bid") {
      log(
        `committed ${formatTokenAmount(state.spent, context.currency)} of ` +
          `${formatTokenAmount(config.strategy.maxSpend, context.currency)}, ` +
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
    log("exiting (--once)");
    return;
  }

  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
    log("stopping...");
    process.exit(0);
  });

  log(`polling every ${config.pollIntervalMs / 1000}s. Ctrl+C to stop.`);
  for (;;) {
    let shouldContinue: boolean;
    try {
      shouldContinue = await cycle();
    } catch (error) {
      if (error instanceof GuardError) throw error; // safety failures must stop the agent
      log(`cycle failed: ${(error as Error).message.split("\n")[0]}`);
      shouldContinue = true;
    }

    if (!shouldContinue) {
      log("nothing further to do - stopping.");
      return;
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    if (stopping) return;
  }
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    console.error(`\n[beacon-agent] configuration error:\n  ${error.message}\n`);
  } else if (error instanceof GuardError) {
    console.error(`\n[beacon-agent] SAFETY GUARD TRIPPED:\n  ${error.message}\n`);
  } else {
    console.error(`\n[beacon-agent] fatal: ${(error as Error).message}\n`);
  }
  process.exitCode = 1;
});
