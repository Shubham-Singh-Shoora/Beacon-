# Beacon

**Developer tooling for Uniswap's [Continuous Clearing Auctions (CCA)](https://github.com/Uniswap/continuous-clearing-auction)** - find every token-launch auction, watch it live, embed it on your site, get alerts, and bid and settle from your terminal. Works on Ethereum, Base, Unichain and Arbitrum, plus their testnets.

[![npm: cca-sdk](https://img.shields.io/npm/v/@hammerock/cca-sdk?label=%40hammerock%2Fcca-sdk)](https://www.npmjs.com/package/@hammerock/cca-sdk)
[![npm: cca-widget](https://img.shields.io/npm/v/@hammerock/cca-widget?label=%40hammerock%2Fcca-widget)](https://www.npmjs.com/package/@hammerock/cca-widget)
[![npm: cca-agent](https://img.shields.io/npm/v/@hammerock/cca-agent?label=%40hammerock%2Fcca-agent)](https://www.npmjs.com/package/@hammerock/cca-agent)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## What it does

A CCA is how a new token launches on Uniswap v4: instead of one price set up
front, the auction sells supply block by block and discovers a clearing price
from everyone's bids. When it ends, the raised funds seed a Uniswap pool.

The contracts are permissionless, but using them well is not easy. Auctions are
scattered across three factory versions and four chains, prices are Q96
fixed-point, bids must sit on a tick boundary, ERC-20 bids go through Permit2,
and **nothing pays out automatically** - every refund and every token has to be
withdrawn with a transaction that needs hints computed from the auction's
history. Beacon handles all of that:

| | What you get |
| --- | --- |
| **Directory** (`apps/web`) | A website listing every CCA auction - live, upcoming and ended - with real-time clearing price, amount raised and graduation status |
| **Widget** (`@hammerock/cca-widget`) | A drop-in card for a project's own site: live auction state plus a bid form. React component or a single `<script>` tag |
| **Bidding agent** (`@hammerock/cca-agent`) | A command-line tool that watches an auction, bids within your price cap and budget, then **settles** - exits your bids and claims your tokens |
| **Alert bot** (`apps/telegram-bot`) | A Telegram bot that pings you when the clearing price crosses a threshold or an auction is about to end |
| **SDK** (`@hammerock/cca-sdk`) | The TypeScript library all of the above are built on. Every contract call in the repo lives here |

## Quick start

**Bid and settle from your terminal** - nothing to install:

```bash
npx @hammerock/cca-agent@latest init      # guided setup: network, auction, limits
npx @hammerock/cca-agent@latest status    # live auction card
npx @hammerock/cca-agent@latest run       # watch and decide - sends nothing
npx @hammerock/cca-agent@latest settle    # find your bids, plan exits and claims
```

Add `--live` to actually send. On a mainnet that also needs `--mainnet` and a
typed confirmation. See the [agent README](apps/bidding-agent/README.md).

**Build on the SDK:**

```bash
npm install @hammerock/cca-sdk viem
```

```ts
import { createBeaconClient, getAuctionSummary } from "@hammerock/cca-sdk";

const client = createBeaconClient({ rpcUrl: "https://mainnet.base.org", chainId: 8453 });
const summary = await getAuctionSummary(client, "0x47abaad854c832f468de31d38b77ceb4e82c4140");
console.log(summary.status, summary.clearingPrice);
```

**Embed an auction** on any page:

```html
<div id="auction"></div>
<script src="https://cdn.jsdelivr.net/npm/@hammerock/cca-widget/dist/mount.global.js"></script>
<script>
  BeaconCCA.mount(document.getElementById("auction"), {
    auction: "0x...", chainId: 8453, rpcUrl: "https://mainnet.base.org",
  });
</script>
```

## Project structure

```
beacon/
├── packages/                     published to npm
│   ├── sdk/                      @hammerock/cca-sdk - contracts, discovery, reads, bids, settlement
│   │   ├── src/abis/             ABIs compiled from Uniswap's pinned source (generated)
│   │   ├── src/discover.ts       find auctions across every factory version
│   │   ├── src/read.ts           live auction state (lens via eth_call state override)
│   │   ├── src/write.ts          bid encoding, tick alignment, Permit2 sequencing
│   │   ├── src/settle.ts         exit + claim planning, checkpoint hint computation
│   │   ├── src/store.ts          JSON auction store (Node-only entry: /node)
│   │   └── scripts/              deploy-demo-auction.ts (creates a test auction)
│   └── widget/                   @hammerock/cca-widget - React card + <script> bundle
├── apps/
│   ├── bidding-agent/            @hammerock/cca-agent - the `cca-agent` CLI (published)
│   ├── web/                      Next.js directory site (deploys to Vercel)
│   └── telegram-bot/             alert bot (long-running Node process)
├── contracts/                    read-only reference: ABI sync script, demo ERC-20
├── data/                         committed auction store, so the site works without a full scan
├── DEMO.md                       step-by-step walkthrough of every surface
└── FEEDBACK.md                   notes on the CCA developer experience
```

It is a pnpm workspace. Inside the repo, the apps consume `packages/*` as
TypeScript source, so there is no build step between editing the SDK and
running an app.

## What each package does

### `@hammerock/cca-sdk` - [README](packages/sdk/README.md)

The only place in the repo that talks to the contracts. The web app, widget, bot
and agent never build their own calls.

- **Discovery** - scans the `AuctionCreated` event of all three factory versions
  in one query, chunked and retried, because public RPCs cap ranges and sometimes
  return false-empty results. A store records which factories it has covered and
  rescans when a new version appears.
- **Reads** - full auction state through Uniswap's `AuctionStateLens`, injected
  into a single `eth_call` as a state override, so it works against any RPC with
  no deployment and no wallet.
- **Bids** - encodes `submitBid`, snaps prices down to a tick boundary (an
  unaligned price reverts), and emits exactly the approvals still outstanding:
  one transaction for ETH, up to three for an ERC-20 via Permit2.
- **Settlement** - finds a bidder's bids by reading the auction directly, decides
  for each whether to exit, partially exit or claim, and computes the two
  checkpoint hints `exitPartiallyFilledBid` requires.
- **Safety** - token names and symbols are cleaned before anything displays
  them; they are attacker-controlled, and live auctions carry names built to
  inject markup.

### `@hammerock/cca-widget` - [README](packages/widget/README.md)

`<AuctionCard>` for React apps, and `mount.global.js` for any HTML page. Shows the
live clearing price, progress and time left, and lets a visitor bid from their own
wallet - it switches the wallet to the right chain, and the visitor signs every
transaction.

### `@hammerock/cca-agent` - [README](apps/bidding-agent/README.md)

The `cca-agent` command. `init` writes a `.env` after showing you the live auction;
`run` bids when the clearing price comes within your band of your price cap; `settle`
exits and claims afterwards. Dry runs by default. Hard budget and bid-count caps,
the private key is read only from your environment and never printed, and mainnet
broadcasting is locked behind an opt-in checked against the chain the RPC actually
reports.

### `apps/web`

The directory site, one deployment for every chain. A chain switcher picks the
network (`/?chain=base`); auction pages carry it (`/auction/0x…?chain=base`), and
an old link without it still works - the page finds the auction in the stores.
Server components read the committed store (no RPC call to list auctions) and fetch
live state for the visible page in one multicall, cached ~15s so RPC use scales
with auctions shown, not visitors.

### `apps/telegram-bot`

Users `/watch <address>` in any chat; one process watches every chain
(`BEACON_BOT_CHAINS`), finds an indexed auction's chain on its own, and accepts
`/watch <address> base` for one too new to be indexed. It alerts on price
thresholds, graduation and closing time. `--dry-run` prints alerts to the
console and `--simulate` drives a whole auction lifecycle through the real alert
logic.

## Networks and factory versions

| Network | Chain id | Kind |
| --- | --- | --- |
| Ethereum | 1 | mainnet |
| Base | 8453 | mainnet |
| Unichain | 130 | mainnet |
| Arbitrum One | 42161 | mainnet |
| Sepolia | 11155111 | testnet |
| Base Sepolia | 84532 | testnet |
| Unichain Sepolia | 1301 | testnet |

Each factory is a CREATE2 singleton at the same address on every chain:

| Version | Factory | Status |
| --- | --- | --- |
| v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` | current |
| v2.0.0 | `0x00cCa200BF124dBfA848937c553864f4B4CE0632` | still read |
| v1.1.0 | `0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5` | deprecated by Uniswap; existing auctions still read |

Source: [Uniswap's deployments page](https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments).
All three emit the same `AuctionCreated` event, and every auction function Beacon
calls has the same signature in each - checked by diffing upstream tags v1.1.0 and
v2.1.0, and by reading and simulating against live v2.1.0 auctions.

## Development

```bash
pnpm install
cp .env.example .env      # RPC URLs, chain id, optional keys
```

| Command | What it runs |
| --- | --- |
| `pnpm test` | Vitest across the workspace |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | ESLint across the workspace |
| `pnpm build` | Builds the published packages (`sdk`, `widget`, `cca-agent`) |
| `pnpm web` | Directory site on :3000 |
| `pnpm bot` | Telegram bot in watch mode (`-- --dry-run` needs no token) |
| `pnpm bot:start` | Telegram bot for a server - no file watching |
| `pnpm agent -- <command>` | The `cca-agent` CLI against the root `.env` |
| `pnpm sync:auctions -- --chain <slug\|mainnets\|all>` | Discover auctions into `data/auctions.<chain>.json` and cache their config |
| `pnpm --filter @hammerock/cca-sdk check:live` | Live read check against a real chain |
| `pnpm deploy:demo -- --dry-run` | Validate demo-auction parameters without spending gas |

Publish with **pnpm**, not npm - only `pnpm publish` rewrites the `workspace:`
dependency ranges:

```bash
pnpm publish -r --filter @hammerock/cca-sdk --filter @hammerock/cca-widget --filter @hammerock/cca-agent --access public
```

## Running it in production

| Piece | Where | Server of your own? |
| --- | --- | --- |
| Directory site | Vercel | No |
| Auction discovery | GitHub Actions, every 30 min ([sync-auctions.yml](.github/workflows/sync-auctions.yml)) | No |
| CI | GitHub Actions on every push and PR ([ci.yml](.github/workflows/ci.yml)) | No |
| Telegram bot | Any always-on host: `pnpm bot:start` | **Yes** - it polls every 15s |

### RPC: free by default

Every chain has a free, keyless default endpoint, with its `eth_getLogs` limits
measured and built in ([networks.ts](packages/sdk/src/networks.ts)). Where the free
RPC will not serve old blocks (Ethereum, Base Sepolia) or would need hundreds of
small requests (Base, Unichain), history is backfilled from Blockscout instead;
routine syncs only scan recent blocks, with a ~6 hour overlap to catch an
endpoint's false-empty answers. A keyed provider is optional - add it as a
fallback per chain with `BEACON_FALLBACK_RPC_URL_<chainId>`.

### The directory on Vercel

| Vercel setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Framework | Next.js (detected) |
| Install / Build | defaults - pnpm is detected from the root lockfile; `build` also bundles the widget for `/embed-demo.html` |
| Node.js | 20 or newer |

No environment variables are required. Optional:

| Variable | Purpose |
| --- | --- |
| `BEACON_FALLBACK_RPC_URL_<chainId>` | Keyed RPC tried when the free one errors. Server-side only |
| `BEACON_RPC_URL_<chainId>` | Replace a chain's free RPC entirely |
| `BEACON_CHAINS` | Chains to list (slugs); default the four mainnets plus Sepolia |
| `BEACON_DEFAULT_CHAIN` | Chain the directory opens on; default `base` |

The embedded bid widget uses each chain's **public** RPC, so no key ever reaches
a visitor's browser.

### Keeping the auction list fresh

The site reads the committed `data/auctions.<chain>.json` stores. The
[sync-auctions](.github/workflows/sync-auctions.yml) workflow refreshes them every
30 minutes and commits only when an auction was actually added or changed, which
triggers a Vercel redeploy. To enable it: Settings → Actions → General →
Workflow permissions → **Read and write**. Fallback RPCs go in repository secrets
with the same names as above.

### The bot

Needs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, a persistent disk for
`data/telegram-subscriptions.json`, and the repo's `data/` stores (pull them to
pick up new auctions). Run `pnpm bot:start`.

## Where Beacon touches the CCA contracts

Beacon is a *consumer* of Uniswap's deployed contracts and never modifies them;
`contracts/` is a read-only reference. Every interaction lives in `packages/sdk`.

| Interaction | File and lines |
| --- | --- |
| **`submitBid`** - encoding | [`packages/sdk/src/write.ts:162-207`](packages/sdk/src/write.ts#L162-L207) - `encodeSubmitBid()`; calls at [`:184`](packages/sdk/src/write.ts#L184) (no-hint overload) and [`:190`](packages/sdk/src/write.ts#L190) (tick-hint overload) |
| **`submitBid`** - broadcast from the agent | [`apps/bidding-agent/src/agent.ts:173`](apps/bidding-agent/src/agent.ts#L173) |
| **`submitBid`** - broadcast from the widget | [`packages/widget/src/AuctionCard.tsx:175`](packages/widget/src/AuctionCard.tsx#L175) |
| **Lens `state()`** | [`packages/sdk/src/read.ts:66-107`](packages/sdk/src/read.ts#L66-L107) - `getAuctionState()`; encoded at [`:69`](packages/sdk/src/read.ts#L69), decoded at [`:97`](packages/sdk/src/read.ts#L97) |
| **Factory `AuctionCreated` event** | [`packages/sdk/src/discover.ts:20`](packages/sdk/src/discover.ts#L20) - the event; scanned at [`:85-167`](packages/sdk/src/discover.ts#L85-L167) (`scanAuctions`, all factories at [`:107`](packages/sdk/src/discover.ts#L107)); watched live at [`:180`](packages/sdk/src/discover.ts#L180) |
| **`exitBid` / `exitPartiallyFilledBid`** | [`packages/sdk/src/settle.ts:291-313`](packages/sdk/src/settle.ts#L291-L313) - `encodeExit()`; hints from `computeExitHints()` at [`:79`](packages/sdk/src/settle.ts#L79) |
| **`claimTokens` / `claimTokensBatch`** | [`packages/sdk/src/settle.ts:316`](packages/sdk/src/settle.ts#L316) - `encodeClaim()`; sent by the agent at [`apps/bidding-agent/src/settle.ts:205`](apps/bidding-agent/src/settle.ts#L205) |
| Bid sequencing (ETH vs ERC-20/Permit2) | [`packages/sdk/src/write.ts:375-427`](packages/sdk/src/write.ts#L375-L427) - `buildBidTransactions()` |
| Reading every bid | [`packages/sdk/src/settle.ts:240`](packages/sdk/src/settle.ts#L240) - `readAllBids()` via `nextBidId` and `bids(id)` |
| Factory `initializeDistribution` (demo auction) | [`packages/sdk/scripts/deploy-demo-auction.ts:199`](packages/sdk/scripts/deploy-demo-auction.ts#L199) |

ABIs are compiled from pinned upstream source by
[`contracts/sync-abis.sh`](contracts/sync-abis.sh), never hand-written.

## Things the SDK handles so you do not have to

- **`state()` is not a view.** The lens calls `auction.checkpoint()` and returns
  data by reverting, so it needs `eth_call` plus `decodeFunctionResult` - a plain
  `readContract` fails.
- **Bid prices must sit on a tick boundary.** `submitBid` reverts with
  `TickPriceNotAtBoundary()` otherwise, and a typed price almost never lands on
  one. Prices are snapped *down*, so a bidder's ceiling can only fall.
- **ERC-20 bids go through Permit2.** Approving the auction directly does
  nothing; the bidder needs an approval to Permit2 and a Permit2 allowance for
  the auction.
- **Nothing pays out automatically.** Refunds and tokens wait in the auction until
  someone exits and claims - anyone may, and the contract always pays the owner.
  Partial exits need two checkpoint block numbers that satisfy the contract's
  exact rules.
- **Public RPCs lie about logs.** Some return an empty array instead of an error
  for a range they will not serve, and some refuse older blocks outright.
  Discovery re-asks empty chunks; settlement avoids logs entirely.

## Live demo

Beacon deployed its own CCA auction on Sepolia so every surface had something
real to act on: [`0x1e40451D6ecabA8640559b7dFbe63B41dA52460d`](https://sepolia.etherscan.io/address/0x1e40451D6ecabA8640559b7dFbe63B41dA52460d)
(BEACON token, native ETH). The agent placed a real bid in it -
[`0x9cd1af26…`](https://sepolia.etherscan.io/tx/0x9cd1af2697f2983c74febc20c03d93056354a75dcac0fce383fde1623de0cc50),
status 1, 383,145 gas - which moved the clearing price off the floor. See
**[DEMO.md](DEMO.md)** for a walkthrough of every surface.

## License

[MIT](LICENSE)
