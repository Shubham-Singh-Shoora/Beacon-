# @hammerock/cca-agent

A command-line bidding agent for Uniswap's [Continuous Clearing Auction (CCA)](https://github.com/Uniswap/continuous-clearing-auction).
It watches one auction and bids when the clearing price comes within a band
of your price cap, never spending more than your budget.

**Networks:** Ethereum, Base, Unichain and Arbitrum One - plus Sepolia, Base Sepolia and Unichain Sepolia.
On a mainnet, `status`, `simulate`, `plan` and dry-run `run` work with no extra steps. **Live bidding
on a mainnet is locked** until you pass `--mainnet` (or set `AGENT_ALLOW_MAINNET=true`) and then type
the network name to confirm.

## Quick start

```bash
npx @hammerock/cca-agent init       # guided setup, writes .env here
npx @hammerock/cca-agent status     # live auction card
npx @hammerock/cca-agent simulate   # see how your strategy behaves
npx @hammerock/cca-agent run        # watch and decide, sends nothing
npx @hammerock/cca-agent run --live # really bid
```

Or install it once: `npm i -g @hammerock/cca-agent`, then use `cca-agent …`.

## Commands

| Command | What it does |
| --- | --- |
| `init` | Asks for the network, auction and your limits, shows the live auction while you answer, and writes `.env` |
| `status` | Clearing price, floor, raised, time left |
| `simulate` | Drives the real strategy through a scripted price walk |
| `plan` | Builds the exact bid transactions and prints them, never sends |
| `run` | Polls the auction and prints each decision. Dry run by default |
| `run --live` | Same, but sends the bids. Asks for confirmation first (`--yes` skips it) |
| `run --live --mainnet` | Live bidding on a mainnet - real money. You type the network name to confirm |
| `settle` | Finds your bids, works out what each needs, and simulates the exits and claims. Sends nothing |
| `settle --live` | Sends them: refunds and tokens go to the bid owner |

Options: `--env <path>`, `--once`, `--auction <addr>` (status, settle), `--owner <addr>` and `--bid <ids>` (settle), `--mainnet`, `--yes`, `--version`.

## Your private key

Live mode reads `AGENT_PRIVATE_KEY` from `.env` or your shell, and nothing else.
The key never leaves your machine and is never printed - only the wallet
address is. `init` deliberately does not ask for it.

Use a dedicated wallet holding no more than your budget plus gas, and keep
`.env` out of git.

## Safety rails

- Refuses any chain it does not explicitly list, and locks mainnet broadcasting
  behind an opt-in - checked against both your config and what the RPC actually reports.
- Hard budget cap, re-checked immediately before every send.
- Bid count limit, independent of the budget.
- Bid prices are snapped *down* to the auction's tick spacing, so you never pay
  above your cap.
- ERC-20 auctions get the Permit2 approvals they need, in order.
- Token names and symbols are cleaned before display - they are set by whoever
  deployed the token, and live auctions carry names built to inject markup.

## Settling: getting your refund and tokens

A CCA never pays anyone automatically. When you are outbid, or the auction
ends, your refund and tokens wait inside the auction until someone calls
`exitBid` / `exitPartiallyFilledBid` and then `claimTokens`. `settle` does that:

```bash
cca-agent settle                 # dry run: finds your bids, plans, simulates
cca-agent settle --live          # sends the exits, then the claim
```

| Your bid | What `settle` does |
| --- | --- |
| Auction did not graduate | Full refund, once the auction ends |
| Won (max price above the final price) | Exits after the end, then claims your tokens |
| Outbid | Exits early for a refund - even before the auction ends |
| Ended exactly at your price | Exits after the end (partial fill), then claims |

- **Anyone can settle any bid, and the contract always pays the bid's owner.**
  So the key here only pays gas - it can be a different wallet from the one that
  bid. `--owner 0x…` settles someone else's bids (they get the money, you pay gas).
- Outbid and partial-fill exits need two checkpoint block numbers as hints.
  `settle` works them out from the auction's checkpoint history, and **every
  transaction is simulated against the live contract first** - if one would
  revert, nothing is sent.
- Bids are found by reading the auction directly, not from event logs, so it
  works on free public RPCs.
- Tokens become claimable at the auction's claim block. If that has not passed,
  `settle` exits what it can and tells you to run it again later.

## Configuration

`init` writes these; you can edit them by hand.

| Variable | Meaning |
| --- | --- |
| `BEACON_CHAIN_ID` | Mainnets `1`, `8453`, `130`, `42161`; testnets `11155111`, `84532`, `1301` |
| `BEACON_RPC_URL` | JSON-RPC endpoint |
| `AGENT_AUCTION_ADDRESS` | The auction to watch |
| `AGENT_MAX_PRICE` | Highest price you will pay, currency per token |
| `AGENT_BID_AMOUNT_WEI` | Size of each bid, in base units |
| `AGENT_MAX_SPEND_WEI` | Total budget, in base units |
| `AGENT_TRIGGER_PERCENT` | Start bidding within this % of the cap (default 10) |
| `AGENT_MAX_BIDS` | Stop after this many bids (default 3) |
| `BEACON_POLL_INTERVAL_SECONDS` | Seconds between checks (default 15) |
| `AGENT_PRIVATE_KEY` | Only for `run --live` |
| `AGENT_ALLOW_MAINNET` | `true` unlocks live bidding on a mainnet (same as `--mainnet`) |

Built on [`@hammerock/cca-sdk`](https://www.npmjs.com/package/@hammerock/cca-sdk). MIT.
