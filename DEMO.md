# Beacon — demo walkthrough

Everything below runs against Beacon's own CCA auction on Sepolia:

| | |
| --- | --- |
| Auction | [`0x1e40451D6ecabA8640559b7dFbe63B41dA52460d`](https://sepolia.etherscan.io/address/0x1e40451D6ecabA8640559b7dFbe63B41dA52460d) |
| Token | BEACON (Beacon Demo), 1,000 supply |
| Currency | native ETH |
| Window | blocks 11663205 → 11666805 |

## Setup (once)

```bash
pnpm install
cp .env.example .env     # fill in BEACON_RPC_URL and the Telegram values
pnpm sync:auctions       # build the auction catalogue
```

## 1. The directory

```bash
pnpm web
```

Open <http://localhost:3000>.

- The header counts **Live / Upcoming / Ended** across 134 indexed auctions.
- The **Live** filter shows the BEACON demo auction with a pulsing badge.
- Note the copy under progress: *"supply schedule released"*, never "% sold" —
  an auction that closes with no bids still reaches 100%.
- Click BEACON for the detail page: live state polls every 12s through a server
  route, so the RPC key never reaches the browser.

## 2. The embeddable widget

Already visible in the right-hand column of any auction detail page — that is
the real `@beacon/cca-widget` component, not a mockup.

For the framework-free version:

```bash
pnpm demo:embed
```

Then open <http://localhost:3000/embed-demo.html> — a static HTML page with no
React and no build step, loading one script and calling `BeaconCCA.mount()`.

On the **live** demo auction the bid form is enabled. On any of the 132 closed
auctions it greys out with *"This auction has ended. Bidding is closed."*

## 3. The Telegram bot

One-time: open **@Beacon_uniswapBot** in Telegram and press **Start**. A bot
cannot message you until you do.

```bash
pnpm bot
```

Then in Telegram:

```
/suggest                                            # ranked from the catalogue
/watch 0x1e40451D6ecabA8640559b7dFbe63B41dA52460d   # follow the demo auction
/status                                             # current state
```

Subscriptions are per chat and persist across restarts.

To see all six alert types fire immediately, without waiting for the market to
move, drive the real alert pipeline through a scripted auction lifecycle:

```bash
pnpm bot -- --simulate
```

No Telegram token? `pnpm bot -- --dry-run` prints the same alerts to the console.

## 4. The bidding agent

Read-only first — real state, real strategy, real calldata, nothing sent:

```bash
pnpm agent -- --dry-run --once
```

See the transaction plan, including the ERC-20/Permit2 branch:

```bash
pnpm agent -- --plan
```

Watch the strategy across a full price walk, including the spend cap and bid
limit stopping it:

```bash
pnpm agent -- --simulate
```

To bid for real, set `AGENT_PRIVATE_KEY` to a funded testnet key and
`AGENT_BROADCAST=true`, then:

```bash
pnpm agent -- --once
```

A real bid from this agent:
[`0x9cd1af26…3de0cc50`](https://sepolia.etherscan.io/tx/0x9cd1af2697f2983c74febc20c03d93056354a75dcac0fce383fde1623de0cc50)
— status 1, 383,145 gas. It moved the clearing price off the floor
(5.42105e-20 → 5.99989e-20 ETH per BEACON) and cleared 2.2216 BEACON.

### Safety, worth showing on camera

```bash
BEACON_CHAIN_ID=1 BEACON_RPC_URL=https://ethereum-rpc.publicnode.com pnpm agent -- --plan
```

Refuses to run. And the case that actually matters — a testnet chain id in
`.env` pointing at a mainnet endpoint:

```bash
BEACON_CHAIN_ID=11155111 BEACON_RPC_URL=https://ethereum-rpc.publicnode.com pnpm agent -- --plan
# SAFETY GUARD TRIPPED: RPC chain id mismatch: configured 11155111, endpoint reports 1.
```

## 5. Deploying another demo auction

```bash
pnpm deploy:demo -- --dry-run          # validates every constructor rule, sends nothing
pnpm deploy:demo                       # needs DEPLOYER_PRIVATE_KEY funded on Sepolia
```

## Verifying the claims

```bash
pnpm test        # 101 SDK + 24 bot + 29 agent
pnpm typecheck
pnpm lint
```

The factory address is verified by rebuilding upstream `v1.1.0` and comparing
bytecode — see the README.
