# Beacon

Developer tooling for Uniswap's [Continuous Clearing Auction (CCA)](https://github.com/Uniswap/continuous-clearing-auction) — a permissionless mechanism for bootstrapping liquidity and price discovery for new token launches on Uniswap v4.

Beacon is four surfaces over one shared SDK:

| Surface | Package | What it does |
| --- | --- | --- |
| Directory site | `apps/web` | Lists every CCA auction ever deployed, live and past, with real-time status |
| Embeddable widget | `packages/widget` | Drop-in card showing live auction state + a bid form, for a project's own site |
| Telegram alert bot | `apps/telegram-bot` | Pings a channel when clearing price crosses a threshold or an auction is ending |
| Bidding agent | `apps/bidding-agent` | Watches an auction and adjusts a bid per a configured strategy |

All four are thin consumers of **`packages/sdk`** (`@beacon/cca-sdk`), which owns every contract call, ABI, event type and Q96 conversion in the repo.

## We do not modify Uniswap's contracts

Beacon is a *consumer* of the already-deployed `ContinuousClearingAuction`, `CCALens` and `ContinuousClearingAuctionFactory` contracts. `contracts/` is a read-only reference copy. Everything new lives in our own packages.

## Where Beacon touches the CCA contracts

Exact file + line references, per the hackathon qualification requirement.
Every contract interaction in the repo lives in `packages/sdk` - the web app,
widget, bot and agent import these and never build their own calls.

| Interaction | Where |
| --- | --- |
| Lens `state()` call | [`packages/sdk/src/read.ts:66-105`](packages/sdk/src/read.ts#L66-L105) - `getAuctionState()` |
| Factory `AuctionCreated` event | [`packages/sdk/src/discover.ts:19`](packages/sdk/src/discover.ts#L19) (event) and [`:67-136`](packages/sdk/src/discover.ts#L67-L136) (`scanAuctions`) |
| Live `AuctionCreated` watching | [`packages/sdk/src/discover.ts:138-163`](packages/sdk/src/discover.ts#L138-L163) - `watchAuctions()` |
| Auction view functions | [`packages/sdk/src/read.ts:108-157`](packages/sdk/src/read.ts#L108-L157) - `getAuctionInfo()`, `getClearingPrice()`, `isGraduated()` |
| `submitBid` | _Phase 4_ |

ABIs are compiled from pinned upstream source by
[`contracts/sync-abis.sh`](contracts/sync-abis.sh), never hand-written.

## Target network and contract addresses (verified)

Beacon targets **Ethereum Sepolia (chain id 11155111)**.

| What | Value |
| --- | --- |
| `ContinuousClearingAuctionFactory` v1.1.0 | `0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5` |
| Factory creation block | `10130119` (2026-01-26) |
| `AuctionCreated` topic0 | `0x7ede475fad18ccf0039f2b956c4d43a8b4ed0853de4daaa8ae25299f331ae3b9` |
| Auctions discovered on Sepolia | 85, across 72 unique tokens |
| `AuctionStateLens` | none published - Beacon runs it via `eth_call` state override, no deployment needed |

**How the factory address was verified.** Not by trusting a docs page or an
explorer badge: we compiled upstream tag `v1.1.0` with Foundry and compared the
result to the live chain. The deployed runtime bytecode is **byte-for-byte
identical** (44,630 hex chars) to our local build. The address is a CREATE2
vanity address deployed through `0x4e59b448...`, which is why it is the same on
every chain Uniswap lists.

### Why not CCALens

The build plan called for `CCALens`, but it does not exist at `v1.1.0` - it was
added in `v2.x`, and no canonical address is published on any network. `CCALens`
is just `Multicallable + AuctionStateLens + TickDataLens`, and its `TickDataLens`
half calls `remainingSupplyQ96X7()`, which **does not exist on the v1.1.0
auctions this factory creates**. Deploying a v2 `CCALens` would therefore give a
working `state()` and a silently reverting tick path.

Beacon instead uses **`AuctionStateLens` built from `v1.1.0`**, which is
guaranteed to match the auctions in the wild. Its `AuctionState` struct is
identical across both versions, so nothing is lost.

Better still, Beacon does not need to deploy it at all: `getAuctionState()`
injects the lens's compiled runtime bytecode into a single `eth_call` via a
state override. Reads work against a bare RPC with **no deployment and no funded
wallet**. Set `BEACON_LENS_ADDRESS` to use a real deployed lens instead.

### Two gotchas the SDK has to handle

- **`state()` is not a `view` function.** It calls `auction.checkpoint()` (which
  mutates) and returns data by reverting with ABI-encoded state. It must be
  invoked with `eth_call` semantics - Beacon uses `publicClient.call()` plus
  `decodeFunctionResult`. A plain `readContract` fails.
- **`eth_getLogs` must be chunked.** Public Sepolia RPCs reject spans over
  50,000 blocks, and some clients report this as an empty result rather than an
  error - which silently looks like "no auctions exist".

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in RPC URL, factory address, etc.
```

| Command | What it runs |
| --- | --- |
| `pnpm test` | Vitest across the workspace |
| `pnpm --filter @beacon/cca-sdk check:live` | Live Sepolia read check: discovers every auction and reads one's state |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | ESLint across the workspace |
| `pnpm build` | Builds the publishable packages (`sdk`, `widget`) |
| `pnpm web` | Next.js directory site on :3000 |
| `pnpm bot` | Telegram alert bot (polling mode) |
| `pnpm agent` | Bidding agent |

Workspace packages are consumed as TypeScript source (Next `transpilePackages`, `tsx` for the Node apps), so there is no build step to run before the apps.

## Safety

**Testnet only.** No mainnet transactions anywhere in this repo. `.env` is gitignored; `.env.example` holds placeholders only. The bidding agent additionally enforces a chain-id allowlist and a hard max-spend cap.

## Build status

- [x] Phase 0 — scaffolding
- [x] Phase 1 — SDK read side
- [ ] Phase 2 — Telegram alert bot
- [ ] Phase 3 — web directory + widget
- [ ] Phase 4 — bidding agent (write side)
- [ ] Phase 5 — demo auction
- [ ] Phase 6 — submission polish

## License

MIT.
