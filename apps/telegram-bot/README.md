# Beacon Telegram worker

The public bot is [@Beacon_uniswapBot](https://t.me/Beacon_uniswapBot). A registered username does not mean a worker is running. Open the bot, tap **Start**, and send `/ping` to verify its connection.

## Test without hosting or an RPC

From the repository root, with Node.js 22 and pnpm 10.23.0:

```sh
pnpm install --frozen-lockfile
pnpm bot:smoke
```

The smoke test produces six labeled, fictional alerts through the real rule engine and renderer. It makes no network requests, sends no Telegram messages, and does not touch subscriptions.

## Configure and run

Set these in the root `.env` or your worker's environment:

```dotenv
TELEGRAM_BOT_TOKEN=your_botfather_token
BEACON_BOT_CHAINS=ethereum,base,unichain,arbitrum,sepolia
BEACON_SUBSCRIPTIONS_PATH=data/telegram-subscriptions.json
BEACON_ALERT_MINUTES_LEFT=15
```

Use `BEACON_RPC_URL_<chainId>` for your provider and `BEACON_FALLBACK_RPC_URL_<chainId>` for alternate providers. Public RPCs can be rate limited; dedicated endpoints are recommended for a user-facing worker. Never put the bot token or keyed RPC URL in a `NEXT_PUBLIC_` variable.

```sh
pnpm bot:check
pnpm bot:start
```

`bot:check` only calls `getMe` and `getWebhookInfo`. It validates the token and checks for webhook conflicts without polling messages or sending anything. It cannot prove that another long-polling worker is running. Run **one worker per token**, with no webhook configured. If another deployment owns the token, stop that deployment before starting this one.

Normal operation needs no `TELEGRAM_CHAT_ID`: `/watch` registers the requesting chat. A chat ID is required only for optional seeded subscriptions, `--once`, or sending `--simulate` output to Telegram. `/chatid` shows the current chat's numeric ID. Use `pnpm bot:smoke` for a simulation that sends nothing.

## User commands

| Command                   | Result                                           |
| ------------------------- | ------------------------------------------------ |
| `/start` or `/help`       | Show the guide                                   |
| `/ping`                   | Confirm this worker is responding                |
| `/suggest base`           | Discover indexed auctions on a network           |
| `/watch <address> base`   | Verify and subscribe to an auction on Base       |
| `/unwatch <address> base` | Remove that subscription                         |
| `/list`                   | Show this chat's saved watches                   |
| `/status`                 | Read their current onchain state                 |
| `/thresholds`             | Show the shared, operator-configured alert rules |
| `/chatid`                 | Show the chat ID for operator setup              |

Replace `base` with `ethereum`, `unichain`, `arbitrum`, or `sepolia`. An omitted chain is inferred only from a unique catalogue match. Each chat can follow up to 20 auctions; identical addresses on different chains remain separate. Alerts are read-only and need no wallet.

## Run continuously with Docker

Vercel runs the website. This bot needs a long-running worker, outbound HTTPS, and a persistent writable volume. Create a dedicated `.env.bot` containing only the bot and RPC settings above, then run from the repository root:

```sh
docker build -f apps/telegram-bot/Dockerfile -t beacon-bot .
docker volume create beacon-bot-state
docker run -d --name beacon-bot --restart unless-stopped --init \
  --env-file .env.bot \
  -e BEACON_SUBSCRIPTIONS_PATH=/state/telegram-subscriptions.json \
  -v beacon-bot-state:/state beacon-bot
docker logs --tail 100 beacon-bot
```

The image runs as the unprivileged `node` user; `.env`, local subscriptions, and Git history are excluded from the build context. Supply only the variables the bot needs in production. Retain the `beacon-bot-state` volume when replacing the container. Back up the subscriptions file before upgrades. Existing version 1 files migrate to chain-aware version 2 on the first successful write; keep a backup if rolling back to an older release.

Docker must be installed on the host. The image definition is provided; an image build and hosted end-to-end delivery still need verification on your chosen host.

## Operations and limitations

- Refresh the catalogue with `pnpm sync:auctions -- --chain mainnets`, then restart or redeploy the worker with the updated `data/auctions.*.json` files. Watches with an explicit chain can read newly created auctions before the next catalogue sync.
- A chain unavailable at startup is retried when needed; other networks remain usable. An invalid token or polling conflict terminates the worker so its host can report/restart it.
- Subscription writes are serialized and atomically replaced. A corrupt file stops startup instead of silently erasing users' watches. Restore it from a known-good backup before restarting.
- The file store is for **one worker**, not several replicas. A multi-worker deployment needs shared transactional persistence and coordinated delivery before scaling out.
- Alerts compare observations. They do not replay events missed while offline, and delivery is best effort if Telegram or the RPC is unavailable. `/status` gives a fresh read. Use a persistent worker and monitor its logs; this is not a guaranteed trading signal service.
- `pnpm bot:start -- --dry-run --once` reads live state without sending messages. Online dry runs use a separate `.dry-run` subscriptions file. The offline smoke test requires no file at all.
