/**
 * Beacon alert bot.
 *
 * Users register auctions themselves with `/watch <address>`, per chat, and
 * those registrations persist. One process watches every configured chain
 * (BEACON_BOT_CHAINS; default the four mainnets plus Sepolia) - a Telegram token
 * can only be polled by one process, so chains are not split across processes.
 * Each chain's catalogue is read from the SAME store the web directory uses,
 * so startup is a file read rather than a factory scan.
 *
 *   pnpm bot -- --dry-run     print alerts to the console, no token needed
 *   pnpm bot -- --once        one read of current state, then exit
 *   pnpm bot -- --simulate    drive the real alert pipeline with scripted changes
 *   pnpm bot                  poll and send to Telegram
 *
 * Works against bare public RPCs: no lens deployment required.
 */
import { Bot } from "grammy";
import type { Context } from "grammy";
import {
  assertChainMatches,
  createBeaconClient,
  deriveStatus,
  formatQ96,
} from "@hammerock/cca-sdk";
import type { Address, BeaconClient } from "@hammerock/cca-sdk";
import { isAddress } from "viem";
import { hasNoActiveRules } from "./alerts";
import { loadConfig } from "./config";
import type { BotChain, BotConfig } from "./config";
import { escapeHtml, renderAlert, renderStatus } from "./format";
import { offlineDemo, runSimulation } from "./simulate";
import { createConsoleSink, createTelegramSink } from "./sink";
import type { AlertSink } from "./sink";
import { SubscriptionStore } from "./subscriptions";
import type { AuctionWatch } from "./subscriptions";
import { createWatcher, loadAuctionCatalogue, suggestAuctions } from "./watcher";
import type { StoreAuction, Watcher } from "./watcher";

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

/** Everything the bot holds for one chain. */
interface ChainRuntime {
  chain: BotChain;
  client: BeaconClient;
  catalogue: Map<string, StoreAuction>;
  watcher: Watcher;
  verified: boolean;
}

async function ensureChain(runtime: ChainRuntime): Promise<boolean> {
  if (runtime.verified) return true;
  try {
    await assertChainMatches(runtime.client);
    runtime.verified = true;
    return true;
  } catch {
    log(`${runtime.chain.network.name}: RPC unavailable or chain mismatch; will retry.`);
    return false;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.offline) {
    const sent = await runSimulation(offlineDemo(), config.thresholds, createConsoleSink());
    log(
      `offline smoke test complete: ${sent} simulated alerts; no network requests or Telegram messages.`,
    );
    return;
  }

  log(`alert rules: ${describeThresholds(config)}`);
  if (hasNoActiveRules(config.thresholds)) {
    log(
      "WARNING: no price or time thresholds set - only graduation, first-clear and status changes will alert.",
    );
  }

  // --- chains ---------------------------------------------------------------
  // Keep unavailable chains registered so a later poll or command can retry.
  const runtimes: ChainRuntime[] = [];
  for (const chain of config.chains) {
    const client = createBeaconClient({
      chainId: chain.network.chainId,
      ...chain.rpc,
      lensAddress: config.lensAddress,
    });
    const catalogue = await loadAuctionCatalogue(chain.storePath, {
      onLog: (m) => log(`${chain.network.name}: ${m}`),
    });
    const watcher = createWatcher(client, catalogue, {
      thresholds: config.thresholds,
      onLog: (m) => log(`${chain.network.name}: ${m}`),
    });
    const runtime = { chain, client, catalogue, watcher, verified: false };
    await ensureChain(runtime);
    runtimes.push(runtime);
  }
  if (runtimes.length === 0) throw new Error("No chain could be reached - check the RPC settings.");
  log(`watching ${runtimes.map((r) => r.chain.network.name).join(", ")}`);

  const bySlug = (slug: string) =>
    runtimes.find((r) => r.chain.network.slug === slug.toLowerCase());
  const byChainId = (id: number) => runtimes.find((r) => r.chain.network.chainId === id);
  const inCatalogues = (address: Address) => {
    const matches = runtimes.filter((r) => r.catalogue.has(address.toLowerCase()));
    return matches.length === 1 ? matches[0] : undefined;
  };

  const subscriptions = new SubscriptionStore(config.subscriptionsPath);
  await subscriptions.load();

  /** The chain an auction is on: as registered, else found in a catalogue. */
  async function runtimeFor(watch: AuctionWatch): Promise<ChainRuntime | undefined> {
    if (watch.chainId !== undefined) return byChainId(watch.chainId);
    const found = inCatalogues(watch.auction);
    // Subscriptions from before multi-chain carry no chain - learn it once.
    if (found) await subscriptions.setChain(watch.auction, found.chain.network.chainId);
    return found;
  }

  /** Group addresses by chain; unknown-chain addresses are reported, not polled. */
  async function groupByChain(watches: readonly AuctionWatch[]) {
    const groups = new Map<ChainRuntime, Address[]>();
    for (const watch of watches) {
      const { auction: address } = watch;
      const runtime = await runtimeFor(watch);
      if (!runtime) {
        log(`no chain known for ${address} - skipping`);
        continue;
      }
      groups.set(runtime, [...(groups.get(runtime) ?? []), address]);
    }
    for (const runtime of groups.keys()) if (!(await ensureChain(runtime))) groups.delete(runtime);
    return groups;
  }

  // Dev/testing seed only. Real usage is /watch.
  if (config.watchAuctions.length > 0 && (config.telegram.chatId || config.dryRun)) {
    for (const auction of config.watchAuctions) {
      const chain = inCatalogues(auction) ?? (runtimes.length === 1 ? runtimes[0] : undefined);
      if (!chain)
        throw new Error(
          "Seed auction has no unambiguous chain. Set BEACON_BOT_CHAINS to its chain.",
        );
      await subscriptions.watch(
        config.telegram.chatId ?? "console",
        auction,
        chain.chain.network.chainId,
      );
    }
    log(
      `seeded ${config.watchAuctions.length} auction(s) from BEACON_WATCH_AUCTION_ADDRESS (dev fallback)`,
    );
  }

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

  const sinkFor = (chatId: string): AlertSink => consoleSink ?? createTelegramSink(bot!, chatId);

  /** Live first, then upcoming, then newest - across the given chains. */
  async function suggestions(scope: ChainRuntime[], limit: number) {
    const ranked: Array<{ runtime: ChainRuntime; entry: StoreAuction; head: bigint }> = [];
    for (const runtime of scope) {
      if (!(await ensureChain(runtime))) continue;
      try {
        const head = await runtime.client.publicClient.getBlockNumber();
        for (const entry of suggestAuctions(runtime.catalogue, head, limit))
          ranked.push({ runtime, entry, head });
      } catch {
        log(`${runtime.chain.network.name}: suggestions temporarily unavailable.`);
      }
    }
    const rank = (s: string) => (s === "live" ? 0 : s === "pending" ? 1 : 2);
    return ranked
      .sort(
        (a, b) =>
          rank(deriveStatus(a.entry.info, a.head)) - rank(deriveStatus(b.entry.info, b.head)),
      )
      .slice(0, limit);
  }

  function describe(runtime: ChainRuntime, entry: StoreAuction, head: bigint): string {
    return (
      `<code>${entry.auction}</code> — <b>${escapeHtml(entry.token.symbol)}</b> ` +
      `on ${escapeHtml(runtime.chain.network.name)} (${deriveStatus(entry.info, head)})`
    );
  }

  const chainList = runtimes.map((r) => r.chain.network.slug).join(", ");
  const HELP = [
    "<b>Beacon</b> watches Uniswap CCA auctions and alerts on clearing price, graduation and closing time.",
    "",
    "/watch &lt;address&gt; [chain] — follow an auction in this chat",
    "/unwatch &lt;address&gt; [chain] — stop following one",
    "/list — auctions this chat follows",
    "/status — current state of those auctions",
    "/suggest [chain] — auctions worth following",
    "/thresholds — the configured alert rules",
    "/ping — check that this worker is online",
    "/chatid — show this chat’s ID for operator setup",
    "",
    `Chains: ${chainList}. Include the chain when an address exists on multiple networks. Up to 20 watches per chat.`,
    "Read-only alerts. No wallet connection, seed phrase or private key needed.",
  ].join("\n");

  // --- one-shot modes -----------------------------------------------------
  if (config.simulate) {
    const seedAddress = config.watchAuctions[0];
    const seed = seedAddress
      ? { runtime: inCatalogues(seedAddress), address: seedAddress }
      : await suggestions(runtimes, 1).then((s) => ({
          runtime: s[0]?.runtime,
          address: s[0]?.entry.auction,
        }));
    if (!seed.runtime || !seed.address) {
      log("No auction available to base the simulation on. Run `pnpm sync:auctions` first.");
      process.exitCode = 1;
      return;
    }

    const base = (await seed.runtime.watcher.viewsFor([seed.address]))[0];
    if (!base) {
      log(`Could not read ${seed.address}.`);
      process.exitCode = 1;
      return;
    }

    const target = consoleSink ?? sinkFor(config.telegram.chatId!);
    log(`simulating a full auction lifecycle through the real alert pipeline...`);
    log(
      `using real metadata from ${base.summary.info.auction} on ${seed.runtime.chain.network.name} ` +
        `(${base.token.symbol}/${base.currency.symbol})`,
    );
    const sent = await runSimulation(base, config.thresholds, target);
    log(`simulation complete - ${sent} alert(s) delivered to ${target.name}`);
    return;
  }

  if (config.once) {
    const auctions = await subscriptions.allWatches();
    if (auctions.length === 0) {
      log("No chat is watching any auction. Use /watch, or set BEACON_WATCH_AUCTION_ADDRESS.");
      return;
    }
    const target = consoleSink ?? sinkFor(config.telegram.chatId!);
    let reported = 0;
    for (const [runtime, group] of await groupByChain(auctions)) {
      for (const view of await runtime.watcher.viewsFor(group)) {
        await target.send(renderStatus(view));
        reported++;
      }
    }
    log(`reported ${reported} auction(s), exiting (--once)`);
    return;
  }

  // --- Telegram commands --------------------------------------------------
  if (bot) {
    const reply = (ctx: Context, text: string) =>
      ctx.chat ? createTelegramSink(bot!, String(ctx.chat.id)).send(text) : Promise.resolve();

    bot.command(["start", "help"], (ctx) => reply(ctx, HELP));
    bot.command("ping", (ctx) =>
      reply(ctx, "Beacon is online. Use /suggest to discover auctions, then /watch to follow one."),
    );
    bot.command("chatid", (ctx) => reply(ctx, `This chat’s ID: <code>${ctx.chat.id}</code>`));

    bot.command("thresholds", (ctx) =>
      reply(ctx, `Alert rules: ${escapeHtml(describeThresholds(config))}`),
    );

    bot.command("watch", async (ctx) => {
      const [rawAddress = "", rawChain] = (ctx.match ?? "").trim().split(/\s+/);
      if (!isAddress(rawAddress)) {
        return reply(ctx, "That is not a valid address. Usage: <code>/watch 0x… [chain]</code>");
      }
      const address = rawAddress as Address;

      let runtime: ChainRuntime | undefined;
      if (rawChain) {
        runtime = bySlug(rawChain);
        if (!runtime)
          return reply(ctx, `Unknown chain "${escapeHtml(rawChain)}". Chains: ${chainList}.`);
      } else {
        runtime = inCatalogues(address);
        if (!runtime) {
          return reply(
            ctx,
            "That address has no unique match in the indexed catalogues. " +
              `Name its chain: <code>/watch ${address} base</code> (chains: ${chainList}).`,
          );
        }
      }

      const chatId = String(ctx.chat.id);
      if (!(await ensureChain(runtime)))
        return reply(ctx, "This network is temporarily unavailable. Please try again shortly.");
      const watches = await subscriptions.watchesFor(chatId);
      if (
        watches.some(
          (w) =>
            w.chainId === runtime.chain.network.chainId &&
            w.auction.toLowerCase() === address.toLowerCase(),
        )
      ) {
        return reply(
          ctx,
          `Already watching <code>${address}</code> on ${escapeHtml(runtime.chain.network.name)}.`,
        );
      }
      if (watches.length >= 20)
        return reply(ctx, "This chat can follow up to 20 auctions. Use /unwatch to make room.");
      const view = (await runtime.watcher.viewsFor([address]))[0];
      if (!view)
        return reply(
          ctx,
          "Could not verify this auction on that network. Check its address and chain, or try again when the RPC recovers. Your watch list was not changed.",
        );
      await subscriptions.watch(chatId, address, runtime.chain.network.chainId);
      return reply(
        ctx,
        `Now watching <code>${address}</code> on ${escapeHtml(runtime.chain.network.name)}.\n\n${renderStatus(view)}`,
      );
    });

    bot.command("unwatch", async (ctx) => {
      const [rawAddress = "", rawChain] = (ctx.match ?? "").trim().split(/\s+/);
      if (!isAddress(rawAddress)) return reply(ctx, "Usage: <code>/unwatch 0x… [chain]</code>");
      const address = rawAddress as Address;
      const runtime = rawChain ? bySlug(rawChain) : undefined;
      if (rawChain && !runtime) return reply(ctx, `Unknown chain. Chains: ${chainList}.`);
      const matches = (await subscriptions.watchesFor(String(ctx.chat.id))).filter(
        (w) =>
          w.auction.toLowerCase() === address.toLowerCase() &&
          (!runtime || w.chainId === runtime.chain.network.chainId),
      );
      if (matches.length > 1)
        return reply(
          ctx,
          "Include its chain: <code>/unwatch &lt;address&gt; &lt;chain&gt;</code>.",
        );
      const watch = matches[0];
      const removed = await subscriptions.unwatch(
        String(ctx.chat.id),
        address,
        watch?.chainId ?? runtime?.chain.network.chainId,
      );
      if (
        removed &&
        watch &&
        (await subscriptions.subscribersOf(address, watch.chainId)).length === 0
      ) {
        (await runtimeFor(watch))?.watcher.forget(address);
      }
      return reply(
        ctx,
        removed
          ? `Stopped watching <code>${address}</code>.`
          : "This chat was not watching that auction.",
      );
    });

    bot.command("list", async (ctx) => {
      const auctions = await subscriptions.watchesFor(String(ctx.chat.id));
      if (auctions.length === 0) {
        return reply(ctx, "This chat is not watching any auctions yet. Try /suggest, then /watch.");
      }
      const lines: string[] = [];
      for (const watch of auctions) {
        const { auction } = watch;
        const runtime = await runtimeFor(watch);
        const entry = runtime?.catalogue.get(auction.toLowerCase());
        lines.push(
          runtime && entry
            ? `<code>${auction}</code> — ${escapeHtml(entry.token.symbol.slice(0, 24))} on ${escapeHtml(runtime.chain.network.name)}`
            : `<code>${auction}</code>${runtime ? ` on ${escapeHtml(runtime.chain.network.name)}` : " (chain unavailable)"}`,
        );
      }
      return reply(ctx, `Watching ${auctions.length}:\n${lines.join("\n")}`);
    });

    bot.command("suggest", async (ctx) => {
      const rawChain = (ctx.match ?? "").trim();
      const scope = rawChain
        ? runtimes.filter((r) => r.chain.network.slug === rawChain.toLowerCase())
        : runtimes;
      if (scope.length === 0)
        return reply(ctx, `Unknown chain "${escapeHtml(rawChain)}". Chains: ${chainList}.`);
      const picks = await suggestions(scope, 5);
      if (picks.length === 0) {
        return reply(ctx, "The auction catalogue is empty. Run <code>pnpm sync:auctions</code>.");
      }
      const total = scope.reduce((n, r) => n + r.catalogue.size, 0);
      return reply(
        ctx,
        `From ${total} indexed auctions:\n${picks.map((p) => describe(p.runtime, p.entry, p.head)).join("\n")}\n\n` +
          "Follow one with <code>/watch &lt;address&gt;</code>.",
      );
    });

    bot.command("status", async (ctx) => {
      const auctions = await subscriptions.watchesFor(String(ctx.chat.id));
      if (auctions.length === 0) return reply(ctx, "This chat is not watching any auctions.");

      let shown = 0;
      for (const [runtime, group] of await groupByChain(auctions)) {
        for (const view of await runtime.watcher.viewsFor(group)) {
          await reply(ctx, renderStatus(view));
          shown++;
        }
      }
      return shown === 0 ? reply(ctx, "Could not read any of those auctions.") : undefined;
    });

    bot.catch(async (error) => {
      log("Telegram command failed; check RPC connectivity and subscription storage.");
      await reply(
        error.ctx,
        "This request could not be completed. Please try again shortly.",
      ).catch(() => undefined);
    });
    void bot
      .start({ onStart: (info) => log(`telegram polling started as @${info.username}`) })
      .catch(() => {
        log(
          "Telegram polling stopped. Check the token, webhook configuration, and that only one worker uses this token.",
        );
        process.exit(1);
      });
  }

  // --- baseline + poll loop ----------------------------------------------
  async function pollOnce(isBaseline: boolean): Promise<void> {
    const auctions = await subscriptions.allWatches();
    if (auctions.length === 0) return;

    for (const [runtime, group] of await groupByChain(auctions)) {
      let result;
      try {
        result = await runtime.watcher.tick(group);
      } catch (error) {
        // One chain's RPC failing must not silence the others.
        log(
          `${runtime.chain.network.name}: poll failed: ${(error as Error).message.split("\n")[0]}`,
        );
        continue;
      }
      const { alerts, views } = result;

      if (isBaseline) {
        log(`${runtime.chain.network.name}: baseline for ${views.size} auction(s)`);
        for (const view of views.values()) {
          log(
            `  ${view.summary.info.auction} ${view.token.symbol}/${view.currency.symbol} ` +
              `${view.summary.status} price=${formatQ96(view.summary.state.checkpoint.clearingPriceQ96)}`,
          );
        }
        continue;
      }

      for (const { alert, view } of alerts) {
        // Route each alert only to the chats that asked for that auction.
        const chatIds = consoleSink
          ? ["console"]
          : await subscriptions.subscribersOf(alert.auction, runtime.chain.network.chainId);
        log(
          `ALERT ${alert.kind} on ${alert.auction} (${runtime.chain.network.name}) -> ${chatIds.length} chat(s)`,
        );
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
    if (bot?.isRunning()) await bot.stop();
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
      // A transient failure must not kill a long-running watcher.
      log(`poll failed: ${(error as Error).message.split("\n")[0]}`);
    }
  }
}

main().catch((error) => {
  console.error(`\n[beacon-bot] fatal: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
