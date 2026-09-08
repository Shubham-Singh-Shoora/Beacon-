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

> Filled in at Phase 6 with exact file + line ranges, per the hackathon qualification requirement.

- `submitBid` — _TODO_
- `CCALens.state()` — _TODO_
- Factory `AuctionCreated` event — _TODO_

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in RPC URL, factory address, etc.
```

| Command | What it runs |
| --- | --- |
| `pnpm test` | Vitest across the workspace |
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
- [ ] Phase 1 — SDK read side
- [ ] Phase 2 — Telegram alert bot
- [ ] Phase 3 — web directory + widget
- [ ] Phase 4 — bidding agent (write side)
- [ ] Phase 5 — demo auction
- [ ] Phase 6 — submission polish

## License

MIT.
