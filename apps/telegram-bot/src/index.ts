/**
 * Beacon alert bot.
 *
 * Watches CCA auctions discovered from the factory and pings Telegram when the
 * clearing price crosses a threshold, an auction is about to end, it graduates,
 * or supply first clears.
 *
 *   pnpm bot -- --dry-run     print alerts to the console, no token needed
 *   pnpm bot -- --once        one read of current state, then exit
 *   pnpm bot -- --simulate    drive the real alert pipeline with scripted changes
 *   pnpm bot                  poll and send to Telegram
 *
 * Works against a bare public RPC: no lens deployment and no BEACON_LENS_ADDRESS
 * are required, because state reads use an eth_call state override.
 */
import { Bot } from "grammy";
import { assertChainMatches, createBeaconClient, formatQ96 } from "@beacon/cca-sdk";
import type { Address } from "viem";
import { isAddress } from "viem";
import { hasNoActiveRules } from "./alerts";
import { loadConfig } from "./config";
import type { BotConfig } from "./config";
import { escapeHtml, renderAlert, renderListEntry, renderStatus } from "./format";
import { runSimulation } from "./simulate";
import { createConsoleSink, createTelegramSink } from "./sink";
import type { AlertSink } from "./sink";
import { createWatcher, resolveWatchList } from "./watcher";

function log(message: string): void {
  console.log(`[beacon-bot] ${message}`);
}

function describeThresholds(config: BotConfig): string {
  const parts: string[] = [];
  if (config.thresholds.priceAboveQ96 !== undefined) {
    parts.push(`price above ${formatQ96(config.thresholds.priceAboveQ96)}`);
  }
  if (config.thresholds.priceBelowQ96 !== undefined) {
    parts.push(`price below ${formatQ96(config.thresholds.priceBelowQ96)}`);
  }
  if (config.thresholds.minutesLeft !== undefined) {
    parts.push(`under ${config.thresholds.minutesLeft} minutes left`);
  }
  return parts.length > 0 ? parts.join(", ") : "none configured";
}

async function main(): Promise<void> {
  const config = loadConfig();

  log(`chain ${config.chainId} via ${config.rpcUrl}`);
  log(`alert rules: ${describeThresholds(config)}`);
  if (hasNoActiveRules(config.thresholds)) {
    log(
      "WARNING: no price or time thresholds set - only graduation, first-clear and status changes will alert.",
    );
  }

  const client = createBeaconClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    lensAddress: config.lensAddress,
  });
  await assertChainMatches(client);
  log(
    config.lensAddress
      ? `using deployed lens ${config.lensAddress}`
      : "no lens deployed - reading state via eth_call state override",
  );

  const { auctions, discovered, anomalies } = await resolveWatchList(
    client,
    config.watchAuctions,
    { limit: config.autoSelectLimit, onLog: log },
  );

  if (anomalies > 0) {
    log(
      `WARNING: the RPC returned ${anomalies} false-empty log chunk(s). Discovery may be incomplete - use a reliable endpoint.`,
    );
  }

  if (auctions.length === 0) {
    log("No auctions to watch. Set BEACON_WATCH_AUCTION_ADDRESS or check the RPC.");
    process.exitCode = 1;
    return;
  }

  log(`watching ${auctions.length} auction(s) of ${discovered} discovered:`);
  for (const auction of auctions) log(`  ${auction}`);

  const watcher = createWatcher(client, auctions, {
    thresholds: config.thresholds,
    autoSelectLimit: config.autoSelectLimit,
    onLog: log,
  });

  // --- delivery -----------------------------------------------------------
  let bot: Bot | undefined;
  let sink: AlertSink;

  if (config.dryRun) {
    sink = createConsoleSink();
  } else {
    bot = new Bot(config.telegram.botToken!);
    sink = createTelegramSink(bot, config.telegram.chatId!);
  }
  log(`alerts -> ${sink.name}`);

  // --- one-shot modes -----------------------------------------------------
  if (config.simulate) {
    log("simulating a full auction lifecycle through the real alert pipeline...");
    const views = await watcher.snapshotViews();
    const base = views[0];
    if (!base) {
      log("Could not read any auction to base the simulation on.");
      process.exitCode = 1;
      return;
    }
    log(`using real metadata from ${base.summary.info.auction} (${base.token.symbol}/${base.currency.symbol})`);
    const sent = await runSimulation(base, config.thresholds, sink);
    log(`simulation complete - ${sent} alert(s) delivered to ${sink.name}`);
    return;
  }

  if (config.once) {
    const { views } = await watcher.tick();
    for (const view of views) {
      await sink.send(renderStatus(view));
    }
    log(`reported ${views.length} auction(s), exiting (--once)`);
    return;
  }

  // --- Telegram commands --------------------------------------------------
  if (bot) {
    bot.command("start", (ctx) =>
      ctx.reply(
        "Beacon watches Uniswap CCA auctions and alerts on clearing price, graduation and closing time.\n\n" +
          "/status - current state of watched auctions\n" +
          "/list - watched auctions, one line each\n" +
          "/watch <address> - add an auction\n" +
          "/unwatch <address> - stop watching one\n" +
          "/thresholds - show the configured alert rules",
      ),
    );
    bot.command("help", (ctx) => ctx.reply("/status /list /watch /unwatch /thresholds"));

    bot.command("thresholds", (ctx) =>
      ctx.reply(`Alert rules: ${describeThresholds(config)}`),
    );

    bot.command("status", async (ctx) => {
      const views = await watcher.snapshotViews();
      if (views.length === 0) return ctx.reply("Not watching any auctions.");
      for (const view of views) {
        await ctx.reply(renderStatus(view), {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
      }
    });

    bot.command("list", async (ctx) => {
      const views = await watcher.snapshotViews();
      if (views.length === 0) return ctx.reply("Not watching any auctions.");
      await ctx.reply(views.map(renderListEntry).join("\n"), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    });

    bot.command("watch", async (ctx) => {
      const arg = ctx.match?.trim();
      if (!arg || !isAddress(arg)) return ctx.reply("Usage: /watch 0x<auction address>");
      watcher.add(arg as Address);
      return ctx.reply(`Now watching ${escapeHtml(arg)}.`);
    });

    bot.command("unwatch", async (ctx) => {
      const arg = ctx.match?.trim();
      if (!arg || !isAddress(arg)) return ctx.reply("Usage: /unwatch 0x<auction address>");
      const removed = watcher.remove(arg as Address);
      return ctx.reply(removed ? `Stopped watching ${escapeHtml(arg)}.` : "That auction was not being watched.");
    });

    bot.catch((error) => console.error("[beacon-bot] telegram error:", error.message));
    void bot.start({ onStart: () => log("telegram polling started") });
  }

  // --- baseline + poll loop ----------------------------------------------
  // The first tick only establishes a baseline. Rules are edge triggered, so
  // without this the bot would alert on conditions that were already true.
  const { views } = await watcher.tick();
  log(`baseline established for ${views.length} auction(s)`);
  for (const view of views) {
    log(
      `  ${view.summary.info.auction} ${view.token.symbol}/${view.currency.symbol} ` +
        `${view.summary.status} price=${formatQ96(view.summary.state.checkpoint.clearingPriceQ96)}`,
    );
  }

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("shutting down...");
    if (bot) await bot.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  log(`polling every ${config.pollIntervalMs / 1000}s. Ctrl+C to stop.`);

  for (;;) {
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    if (stopping) return;
    try {
      const { alerts } = await watcher.tick();
      for (const { alert, view } of alerts) {
        log(`ALERT ${alert.kind} on ${alert.auction}`);
        await sink.send(renderAlert(alert, view));
      }
    } catch (error) {
      // A transient RPC failure must not kill a long-running watcher.
      log(`poll failed: ${(error as Error).message.split("\n")[0]}`);
    }
  }
}

main().catch((error) => {
  console.error(`\n[beacon-bot] fatal: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
