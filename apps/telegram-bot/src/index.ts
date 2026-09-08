/**
 * Beacon alert bot.
 *
 * Users register auctions themselves with `/watch <address>`, per chat, and
 * those registrations persist. The auction catalogue is read from the SAME
 * store the web directory uses, so startup is a file read rather than a 1.5M
 * block factory scan.
 *
 *   pnpm bot -- --dry-run     print alerts to the console, no token needed
 *   pnpm bot -- --once        one read of current state, then exit
 *   pnpm bot -- --simulate    drive the real alert pipeline with scripted changes
 *   pnpm bot                  poll and send to Telegram
 *
 * Works against a bare public RPC: no lens deployment required.
 */
import { Bot } from "grammy";
import { assertChainMatches, createBeaconClient, deriveStatus, formatQ96 } from "@beacon/cca-sdk";
import type { Address } from "@beacon/cca-sdk";
import { isAddress } from "viem";
import { hasNoActiveRules } from "./alerts";
import { loadConfig } from "./config";
import type { BotConfig } from "./config";
import { escapeHtml, renderAlert, renderStatus } from "./format";
import { runSimulation } from "./simulate";
import { createConsoleSink, createTelegramSink } from "./sink";
import type { AlertSink } from "./sink";
import { SubscriptionStore } from "./subscriptions";
import { createWatcher, loadAuctionCatalogue, suggestAuctions } from "./watcher";
import type { StoreAuction } from "./watcher";

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

const HELP = [
  "<b>Beacon</b> watches Uniswap CCA auctions and alerts on clearing price, graduation and closing time.",
  "",
  "/watch &lt;address&gt; — follow an auction in this chat",
  "/unwatch &lt;address&gt; — stop following one",
  "/list — auctions this chat follows",
  "/status — current state of those auctions",
  "/suggest — auctions worth following, from the indexed catalogue",
  "/thresholds — the configured alert rules",
].join("\n");

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
    logsRpcUrl: config.logsRpcUrl,
    chainId: config.chainId,
    lensAddress: config.lensAddress,
  });
  await assertChainMatches(client);
  log(
    config.lensAddress
      ? `using deployed lens ${config.lensAddress}`
      : "no lens deployed - reading state via eth_call state override",
  );

  // Catalogue comes from the shared store, not a live factory scan.
  const catalogue = await loadAuctionCatalogue(config.storePath, { onLog: log });
  const subscriptions = new SubscriptionStore(config.subscriptionsPath);
  await subscriptions.load();

  // Dev/testing seed only. Real usage is /watch.
  if (config.watchAuctions.length > 0 && config.telegram.chatId) {
    for (const auction of config.watchAuctions) {
      await subscriptions.watch(config.telegram.chatId, auction);
    }
    log(
      `seeded ${config.watchAuctions.length} auction(s) from BEACON_WATCH_AUCTION_ADDRESS (dev fallback)`,
    );
  }

  const watcher = createWatcher(client, catalogue, {
    thresholds: config.thresholds,
    onLog: log,
  });

  // --- delivery -----------------------------------------------------------
  let bot: Bot | undefined;
  let consoleSink: AlertSink | undefined;

  if (config.dryRun) {
    consoleSink = createConsoleSink();
    log("alerts -> console (dry run)");
  } else {
    bot = new Bot(config.telegram.botToken!);
    log("alerts -> Telegram, routed per subscribed chat");
  }

  const sinkFor = (chatId: string): AlertSink =>
    consoleSink ?? createTelegramSink(bot!, chatId);

  const headBlock = await client.publicClient.getBlockNumber();

  function resolveAuction(input: string): { address?: Address; error?: string } {
    const trimmed = input.trim();
    if (!isAddress(trimmed)) {
      return { error: "That is not a valid address. Usage: <code>/watch 0x…</code>" };
    }
    return { address: trimmed as Address };
  }

  function describeCatalogueEntry(entry: StoreAuction): string {
    const status = deriveStatus(entry.info, headBlock);
    return `<code>${entry.auction}</code> — <b>${escapeHtml(entry.token.symbol)}</b> (${status})`;
  }

  // --- one-shot modes -----------------------------------------------------
  if (config.simulate) {
    const seed =
      config.watchAuctions[0] ??
      suggestAuctions(catalogue, headBlock, 1)[0]?.auction ??
      undefined;
    if (!seed) {
      log("No auction available to base the simulation on. Run `pnpm sync:auctions` first.");
      process.exitCode = 1;
      return;
    }

    const views = await watcher.viewsFor([seed]);
    const base = views[0];
    if (!base) {
      log(`Could not read ${seed}.`);
      process.exitCode = 1;
      return;
    }

    const target = consoleSink ?? sinkFor(config.telegram.chatId!);
    log(`simulating a full auction lifecycle through the real alert pipeline...`);
    log(`using real metadata from ${base.summary.info.auction} (${base.token.symbol}/${base.currency.symbol})`);
    const sent = await runSimulation(base, config.thresholds, target);
    log(`simulation complete - ${sent} alert(s) delivered to ${target.name}`);
    return;
  }

  if (config.once) {
    const auctions = await subscriptions.allAuctions();
    if (auctions.length === 0) {
      log("No chat is watching any auction. Use /watch, or set BEACON_WATCH_AUCTION_ADDRESS.");
      return;
    }
    const views = await watcher.viewsFor(auctions);
    const target = consoleSink ?? sinkFor(config.telegram.chatId!);
    for (const view of views) await target.send(renderStatus(view));
    log(`reported ${views.length} auction(s), exiting (--once)`);
    return;
  }

  // --- Telegram commands --------------------------------------------------
  if (bot) {
    const reply = (ctx: { reply: (t: string, o?: object) => Promise<unknown> }, text: string) =>
      ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });

    bot.command(["start", "help"], (ctx) => reply(ctx, HELP));

    bot.command("thresholds", (ctx) =>
      reply(ctx, `Alert rules: ${escapeHtml(describeThresholds(config))}`),
    );

    bot.command("watch", async (ctx) => {
      const { address, error } = resolveAuction(ctx.match ?? "");
      if (!address) return reply(ctx, error!);

      const chatId = String(ctx.chat.id);
      const known = catalogue.get(address.toLowerCase());
      const added = await subscriptions.watch(chatId, address);

      if (!added) return reply(ctx, `Already watching <code>${address}</code>.`);

      // An address outside the catalogue is still accepted - it may be newer
      // than the last sync - but say so rather than pretending it is known.
      const note = known
        ? `<b>${escapeHtml(known.token.symbol)}</b> (${deriveStatus(known.info, headBlock)})`
        : "not in the indexed catalogue — it may be newer than the last sync, or not a CCA auction";

      return reply(ctx, `Now watching <code>${address}</code>\n${note}`);
    });

    bot.command("unwatch", async (ctx) => {
      const { address, error } = resolveAuction(ctx.match ?? "");
      if (!address) return reply(ctx, error!);

      const removed = await subscriptions.unwatch(String(ctx.chat.id), address);
      if (removed && (await subscriptions.subscribersOf(address)).length === 0) {
        watcher.forget(address);
      }
      return reply(
        ctx,
        removed
          ? `Stopped watching <code>${address}</code>.`
          : "This chat was not watching that auction.",
      );
    });

    bot.command("list", async (ctx) => {
      const auctions = await subscriptions.auctionsFor(String(ctx.chat.id));
      if (auctions.length === 0) {
        return reply(ctx, "This chat is not watching any auctions yet. Try /suggest, then /watch.");
      }
      const lines = auctions.map((auction) => {
        const entry = catalogue.get(auction.toLowerCase());
        return entry ? describeCatalogueEntry(entry) : `<code>${auction}</code>`;
      });
      return reply(ctx, `Watching ${auctions.length}:\n${lines.join("\n")}`);
    });

    bot.command("suggest", async (ctx) => {
      const suggestions = suggestAuctions(catalogue, headBlock, 5);
      if (suggestions.length === 0) {
        return reply(ctx, "The auction catalogue is empty. Run <code>pnpm sync:auctions</code>.");
      }
      return reply(
        ctx,
        `From ${catalogue.size} indexed auctions:\n${suggestions.map(describeCatalogueEntry).join("\n")}\n\nFollow one with <code>/watch &lt;address&gt;</code>.`,
      );
    });

    bot.command("status", async (ctx) => {
      const auctions = await subscriptions.auctionsFor(String(ctx.chat.id));
      if (auctions.length === 0) return reply(ctx, "This chat is not watching any auctions.");

      const views = await watcher.viewsFor(auctions);
      if (views.length === 0) return reply(ctx, "Could not read any of those auctions.");
      for (const view of views) await reply(ctx, renderStatus(view));
      return undefined;
    });

    bot.catch((error) => console.error("[beacon-bot] telegram error:", error.message));
    void bot.start({ onStart: (info) => log(`telegram polling started as @${info.username}`) });
  }

  // --- baseline + poll loop ----------------------------------------------
  async function pollOnce(isBaseline: boolean): Promise<void> {
    const auctions = await subscriptions.allAuctions();
    if (auctions.length === 0) return;

    const { alerts, views } = await watcher.tick(auctions);

    if (isBaseline) {
      log(`baseline established for ${views.size} auction(s) across all chats`);
      for (const view of views.values()) {
        log(
          `  ${view.summary.info.auction} ${view.token.symbol}/${view.currency.symbol} ` +
            `${view.summary.status} price=${formatQ96(view.summary.state.checkpoint.clearingPriceQ96)}`,
        );
      }
      return;
    }

    for (const { alert, view } of alerts) {
      // Route each alert only to the chats that asked for that auction.
      const chatIds = consoleSink
        ? ["console"]
        : await subscriptions.subscribersOf(alert.auction);

      log(`ALERT ${alert.kind} on ${alert.auction} -> ${chatIds.length} chat(s)`);
      const message = renderAlert(alert, view);
      for (const chatId of chatIds) {
        try {
          await sinkFor(chatId).send(message);
        } catch (error) {
          log(`failed to deliver to ${chatId}: ${(error as Error).message.split("\n")[0]}`);
        }
      }
    }
  }

  // The first tick only establishes a baseline. Rules are edge triggered, so
  // without this the bot would alert on conditions that were already true.
  await pollOnce(true);

  if (await subscriptions.isEmpty()) {
    log("No chat is watching any auction yet - send /watch <address> in Telegram to start.");
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
      await pollOnce(false);
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
