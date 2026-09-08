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

## Live demo

Beacon deployed its own CCA auction on Sepolia so all four surfaces have
something real to act on:

| | |
| --- | --- |
| Auction | [`0x1e40451D6ecabA8640559b7dFbe63B41dA52460d`](https://sepolia.etherscan.io/address/0x1e40451D6ecabA8640559b7dFbe63B41dA52460d) |
| Token | BEACON (Beacon Demo), 1,000 supply, 18 decimals |
| Currency | native ETH |
| Window | blocks 11663205 → 11666805 (~12 hours) |
| A real bid from the agent | [`0x9cd1af26…3de0cc50`](https://sepolia.etherscan.io/tx/0x9cd1af2697f2983c74febc20c03d93056354a75dcac0fce383fde1623de0cc50) — status 1, 383,145 gas |

That bid moved the clearing price off the floor (5.42105e-20 → 5.99989e-20 ETH
per BEACON) and cleared 2.2216 BEACON, which the directory, the widget and the
bot all read back through the same SDK.

## We do not modify Uniswap's contracts

Beacon is a *consumer* of the already-deployed `ContinuousClearingAuction`, `CCALens` and `ContinuousClearingAuctionFactory` contracts. `contracts/` is a read-only reference copy. Everything new lives in our own packages.

## Where Beacon touches the CCA contracts

Exact file + line references, per the hackathon qualification requirement.
**Every contract interaction in the repo lives in `packages/sdk`** — the web
app, widget, bot and agent import these and never build their own calls.

### The three required interactions

| Interaction | File and lines |
| --- | --- |
| **`submitBid`** — encoding | [`packages/sdk/src/write.ts:162-207`](packages/sdk/src/write.ts#L162-L207) — `encodeSubmitBid()`; the `submitBid` calls are at [`:184`](packages/sdk/src/write.ts#L184) (no-hint overload) and [`:190`](packages/sdk/src/write.ts#L190) (tick-hint overload) |
| **`submitBid`** — broadcast from the agent | [`apps/bidding-agent/src/agent.ts:173`](apps/bidding-agent/src/agent.ts#L173) |
| **`submitBid`** — broadcast from the widget | [`packages/widget/src/AuctionCard.tsx:175`](packages/widget/src/AuctionCard.tsx#L175) |
| **Lens `state()`** | [`packages/sdk/src/read.ts:66-105`](packages/sdk/src/read.ts#L66-L105) — `getAuctionState()`; the `state` call is encoded at [`:69`](packages/sdk/src/read.ts#L69) and decoded at [`:97`](packages/sdk/src/read.ts#L97) |
| **Factory `AuctionCreated` event** | [`packages/sdk/src/discover.ts:19`](packages/sdk/src/discover.ts#L19) — the event; scanned at [`:83-163`](packages/sdk/src/discover.ts#L83-L163) (`scanAuctions`, filter at [`:105`](packages/sdk/src/discover.ts#L105)); watched live at [`:179`](packages/sdk/src/discover.ts#L179) |

### Supporting interactions

| Interaction | File and lines |
| --- | --- |
| Factory `initializeDistribution` (creates our demo auction) | [`packages/sdk/scripts/deploy-demo-auction.ts:195`](packages/sdk/scripts/deploy-demo-auction.ts#L195) |
| Bid transaction sequencing (native vs ERC-20/Permit2) | [`packages/sdk/src/write.ts:375-430`](packages/sdk/src/write.ts#L375-L430) — `buildBidTransactions()` |
| Tick-boundary alignment for bid prices | [`packages/sdk/src/write.ts`](packages/sdk/src/write.ts) — `alignPriceToTickBoundary()` |
| `prevTickPrice` hint lookup | [`packages/sdk/src/write.ts`](packages/sdk/src/write.ts) — `getPrevTickHint()` |
| Auction view functions | [`packages/sdk/src/read.ts`](packages/sdk/src/read.ts) — `getAuctionInfo()`, `getClearingPrice()`, `isGraduated()`, `getAuctionListStates()` |
| `AuctionParameters` encode/decode | [`packages/sdk/src/auctionParameters.ts`](packages/sdk/src/auctionParameters.ts) |

ABIs are compiled from pinned upstream source by
[`contracts/sync-abis.sh`](contracts/sync-abis.sh) at tag `v1.1.0`
(`a0aabaa`), never hand-written.

## Target network and contract addresses (verified)

Beacon targets **Ethereum Sepolia (chain id 11155111)**.

| What | Value |
| --- | --- |
| `ContinuousClearingAuctionFactory` v1.1.0 | `0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5` |
| Factory creation block | `10130119` (2026-01-26) |
| `AuctionCreated` topic0 | `0x7ede475fad18ccf0039f2b956c4d43a8b4ed0853de4daaa8ae25299f331ae3b9` |
| Auctions discovered on Sepolia | 134, across 112 unique tokens |
| **Beacon's own demo auction** | [`0x1e40451D6ecabA8640559b7dFbe63B41dA52460d`](https://sepolia.etherscan.io/address/0x1e40451D6ecabA8640559b7dFbe63B41dA52460d) |
| Demo token (BEACON) | [`0xfd352aceb064802f13173e50a1b3c80172541167`](https://sepolia.etherscan.io/address/0xfd352aceb064802f13173e50a1b3c80172541167) |
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

### RPC providers: state and logs need different endpoints

Beacon takes two RPC URLs, because no single free endpoint does both jobs well:

| | `BEACON_RPC_URL` | `BEACON_LOGS_RPC_URL` |
| --- | --- | --- |
| Used for | `eth_call`, multicall | `eth_getLogs` discovery |
| Wants | low latency, reliable | wide block ranges |
| Alchemy free tier | excellent (~800ms full read) | **unusable** - caps `eth_getLogs` at 10 blocks, so a 1.5M-block backfill would be ~153,000 requests |
| publicnode | fine | allows 50k ranges, but **silently unreliable** |

An identical `eth_getLogs` against `ethereum-sepolia-rpc.publicnode.com` returns
the real logs about half the time and an empty array the rest, with no error.
Four full scans returned 52, 60, 44 and 55 auctions. That is why discovery is
persisted to a store and converged over repeated passes rather than re-scanned
per page load - and why `data/auctions.sepolia.json` is committed.

### Two gotchas the SDK has to handle

- **`state()` is not a `view` function.** It calls `auction.checkpoint()` (which
  mutates) and returns data by reverting with ABI-encoded state. It must be
  invoked with `eth_call` semantics - Beacon uses `publicClient.call()` plus
  `decodeFunctionResult`. A plain `readContract` fails.
- **`eth_getLogs` must be chunked.** Public Sepolia RPCs reject spans over
  50,000 blocks, and some clients report this as an empty result rather than an
  error - which silently looks like "no auctions exist".

## Demo

See **[DEMO.md](DEMO.md)** for a step-by-step walkthrough of all four surfaces
against Beacon's live demo auction.

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
| `pnpm bot -- --dry-run` | Print alerts to the console - no bot token needed |
| `pnpm bot -- --once` | Read current state once and exit |
| `pnpm bot -- --simulate` | Drive the real alert pipeline through a full auction lifecycle |
| `pnpm sync:auctions` | Scan `AuctionCreated` into the local store, then cache each auction's config |
| `pnpm sync:auctions -- --full --passes 3` | Re-scan everything, unioning passes to converge on a flaky RPC |
| `pnpm demo:embed` | Build the vanilla widget bundle into the web app's `public/` |
| `pnpm deploy:demo -- --dry-run` | Validate demo-auction parameters against every constructor rule |
| `pnpm deploy:demo` | Deploy the demo ERC-20 + CCA auction (needs a funded testnet key) |
| `pnpm agent` | Bidding agent (broadcasts only if `AGENT_BROADCAST=true`) |
| `pnpm agent -- --simulate` | Drive the real strategy through a scripted price walk |
| `pnpm agent -- --plan` | Build and print the real bid transactions; never sends |
| `pnpm agent -- --dry-run --once` | One real decision cycle against live state; never sends |

Workspace packages are consumed as TypeScript source (Next `transpilePackages`, `tsx` for the Node apps), so there is no build step to run before the apps.

## How the directory gets its data

```
factory AuctionCreated  ->  pnpm sync:auctions  ->  data/auctions.sepolia.json
                                                              |
                            Server Components read the store (no RPC)
                                                              |
                            + one multicall for the visible page's live state
```

The store caches only IMMUTABLE data - start/end block, token, currency, supply,
floor price, and each token's symbol/decimals. Live state (clearing price,
raised, cleared, graduated) is always read from chain. Auctions are append-only,
so a cached list can only ever be missing very recent entries, which the next
sync picks up.

The web app contains **no indexing logic of its own** - `apps/web/lib/beacon.ts`
is a thin wrapper over the SDK's `scanAuctions`, `getAuctionListStates`,
`getAuctionState` and `JsonAuctionStore`.

### Design note: "ended" is the normal state

Of the 133 auctions on Sepolia, 132 have closed and none are live. The directory
is built for that: `Ended` is a neutral badge rather than a warning, the
zero-live case renders as an explanatory line instead of an empty screen, and
`Graduated` / `Did not graduate` carries the actual outcome. Progress is
labelled "supply schedule released", never "% sold" - an auction that closes
with no bids still reaches 100%.

## The bidding agent

`apps/bidding-agent` watches one auction and bids when the clearing price comes
within a configured band of the operator's price cap.

**Guardrails**, all failing closed:

- **Testnet only.** Mainnet chain ids are absent from the allowlist rather than
  blocked by a condition. The chain is checked twice - the configured id, and
  the id the RPC actually reports - so a mainnet endpoint behind a testnet
  `BEACON_CHAIN_ID` is rejected, not trusted.
- **Hard max-spend cap**, enforced by the strategy and re-checked immediately
  before every send.
- **Bid count limit**, independent of the budget.
- **The private key is read only from `.env`**, validated by shape, and
  converted straight to a viem account. Only the derived address is ever logged.
- **Broadcasting is opt-in**: `AGENT_BROADCAST=true`, and `--dry-run` / `--plan`
  always override it.

**Rounding direction matters here.** The price cap is parsed with the SDK's
`decimalToQ96`, which truncates toward zero, so the effective ceiling is never
above what the operator typed. The trigger threshold also truncates down, which
can only make the agent bid *earlier*, never at a higher price - and the price
it submits is always the cap itself, so an early trigger cannot overpay. These
directions are asserted in `apps/bidding-agent/test/strategy.test.ts`.

### Bid prices must sit on a tick boundary

`submitBid` reverts with `TickPriceNotAtBoundary()` (`0xd76fb50f`) unless
`maxPrice` is an exact multiple of the auction's `tickSpacing`. The constructor
applies that rule to the floor price, and it applies to **every bid** too, which
is not documented. A price a human types essentially never lands on a boundary.

`alignPriceToTickBoundary()` snaps a price DOWN - the only safe direction, since
it can lower a bidder's ceiling but never raise it. `buildBidTransactions()`
applies it automatically, and the widget shows the adjusted price before the
bidder commits.

This was found by running the agent against a forked Sepolia: the first real
`submitBid` reverted.

### ERC-20 bids go through Permit2

This is the single easiest thing to get wrong. `ContinuousClearingAuction`
pulls a non-native bid currency with `SafeTransferLib.permit2TransferFrom`,
which calls Permit2's `transferFrom(from,to,uint160,token)` (`0x36c78516`).
**Approving the auction directly does nothing** - the auction never calls
`token.transferFrom`. A bidder needs two approvals:

1. `ERC20.approve(0x000000000022D473030F116dDEE9F6B43aC78BA3, amount)`
2. `Permit2.approve(token, auction, amount, expiration)`

`buildBidTransactions()` emits exactly the steps still outstanding - one
transaction for a native auction, up to three for an ERC-20 one - and both the
widget and the agent use it, so neither can drift from the other.

## The demo auction

`pnpm deploy:demo` creates an auction Beacon controls, because every CCA auction
already on Sepolia has closed. The flow, in the order the contracts demand:

1. deploy a demo ERC-20 (whole supply to the deployer)
2. `factory.initializeDistribution(token, amount, configData, salt)`
3. transfer the supply to the new auction
4. **`auction.onTokensReceived()`** — without this the auction exists, looks
   configured, and rejects every bid

`encodeAuctionParameters()` validates every constructor rule before any gas is
spent, naming the revert each check prevents. It is verified by decoding real
`configData` from auctions that actually deployed and re-encoding it
byte-identically.

### Verified against a Sepolia fork

The whole path was exercised on `anvil --fork-url <sepolia>`, against the real
deployed factory bytecode:

| Step | Result |
| --- | --- |
| Deploy demo ERC-20 + auction | auction created, `AuctionCreated` decoded |
| `onTokensReceived()` | accepted |
| Agent reads state | `status=live` |
| Agent `submitBid` | **receipt status 1**, `BidSubmitted` emitted, `nextBidId` 1, auction balance 0.001 ETH |

Reproduce it with:

```bash
anvil --fork-url $BEACON_RPC_URL --host 0.0.0.0 --port 8545 --chain-id 11155111
pnpm deploy:demo -- --rpc http://localhost:8545 --duration 1200 --start-delay 3
```

## Safety

**Testnet only.** No mainnet transactions anywhere in this repo. `.env` is gitignored; `.env.example` holds placeholders only. The bidding agent additionally enforces a chain-id allowlist and a hard max-spend cap.

## Build status

- [x] Phase 0 — scaffolding
- [x] Phase 1 — SDK read side
- [x] Phase 2 — Telegram alert bot
- [x] Phase 3 — web directory + widget
- [x] Phase 4 — bidding agent (write side)
- [x] Phase 5 — demo auction (deployed and live on Sepolia)
- [x] Phase 6 — submission polish

## License

MIT.
