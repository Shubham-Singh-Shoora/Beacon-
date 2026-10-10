# Deploying Beacon's web app and alert worker

The website, scheduled indexer, and Telegram worker have separate runtimes. A Vercel deployment does not start the bot, and installing the analytics components alone does not collect events until the updated site is deployed.

## Website

- Keep the Vercel root directory at `apps/web`; its build script builds the widget, copies the browser bundle, and runs `next build`.
- Configure private `BEACON_RPC_URL_<chainId>` and optional `BEACON_FALLBACK_RPC_URL_<chainId>` variables for each listed network. Do not use `NEXT_PUBLIC_` for keyed provider URLs.
- The public auction-state API shares successful responses with the CDN for 10 seconds and permits stale responses during revalidation for 20 seconds. In-process reads are deduplicated, memory-bounded, and limited to 20 simultaneous operations. These limits are per instance; use Vercel Firewall rules and provider quotas for distributed abuse control.
- The directory reports when its index is more than approximately two hours behind the network. Existing auction state can be current even when new discovery is delayed. The committed `data/auctions.*.json` files must ship with the deployment; tracing is configured in the Next app.
- `@vercel/analytics/next` and `@vercel/speed-insights/next` are mounted once in the root layout. Enable both products in the Vercel project, deploy this revision, then verify visits and performance events in their dashboards. No custom wallet or Telegram identifiers are attached to analytics events.

## Scheduled discovery

The `Sync auctions` workflow runs every 30 minutes and can be dispatched manually with comma-separated chain slugs. It runs every selected network even if another fails, retries a failed network once, and still reports an incomplete run as a failure. Metadata enrichment failures also fail the run.

Configure GitHub repository secrets for dedicated providers:

| Secret                         | Purpose                                    |
| ------------------------------ | ------------------------------------------ |
| `BEACON_RPC_URL_<id>`          | State reads and block height               |
| `BEACON_LOGS_RPC_URL_<id>`     | Log reads, optionally a different provider |
| `BEACON_FALLBACK_RPC_URL_<id>` | Comma-separated fallback providers         |

The default workflow lists Ethereum `1`, Base `8453`, Unichain `130`, Arbitrum `42161`, and Sepolia `11155111`. The optional Base repository variable `BEACON_SYNC_CHUNK_SIZE_8453` defaults to `500`. Public Base log endpoints rejected the previous 2,000-block requests during verification; smaller requests succeeded. Public endpoints can change their quotas, so they are a fallback rather than a production availability guarantee.

The operational adapter in `.github/scripts/sync-chain.ts` applies provider limits using the existing SDK API. It verifies both providers' chain IDs and atomically replaces a catalogue only after a complete write. Every successful checkpoint is committed, including runs that find no new auctions. This prevents delayed schedules from indefinitely rescanning an old checkpoint. A rebase protects concurrent changes before the bot pushes.

After pushing this revision:

1. Dispatch **Sync auctions**, first with `base`, then the normal set of networks.
2. Check the per-network job summary, enrichment counts, and new `lastSyncedBlock` values. A green process exit alone is not a substitute for complete metadata.
3. Confirm Vercel deploys the updated catalogue commit. If branch protections prevent the sync bot from pushing, configure an approved data-update path; do not disable protections blindly.
4. If catching up from a long outage times out or explorer backfill fails, configure a provider that serves historical logs before retrying. Never advance a checkpoint manually past unscanned blocks.

## Telegram

See the [worker runbook](../apps/telegram-bot/README.md) for credentials, Docker, persistent storage, commands, smoke tests, and recovery. The public account is [@Beacon_uniswapBot](https://t.me/Beacon_uniswapBot).

```sh
pnpm bot:smoke  # offline simulation; sends nothing
pnpm bot:check  # read-only token / webhook diagnostics
pnpm bot:start # continuous worker; run on one host per bot token
```

The first two checks cannot confirm hosted message delivery. Verify that separately by opening the bot yourself, sending `/ping`, following an auction on its explicit chain, and inspecting `/status` and `/list`. Persist the subscription volume across worker restarts. The worker retries bounded Telegram rate limits and isolates chain-specific subscriptions, but missed events during downtime are not replayed.

## Validation and release boundary

CI checks types, lint, workspace tests, sync retry/persistence tests, the offline bot lifecycle, package builds, and the production web build. Shared package source is unchanged by this hardening pass.

This establishes a single-worker beta foundation. It does not certify unlimited capacity, guarantee notifications, or audit the SDK, widget, agent, or auction contracts for financial safety. Before a wider launch, verify the hosted worker, dedicated RPC quotas, the deployed sync run, monitoring events, and behavior under your expected traffic.
