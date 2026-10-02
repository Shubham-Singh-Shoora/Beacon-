# @hammerock/cca-sdk

TypeScript SDK for [Uniswap Continuous Clearing Auctions](https://github.com/Uniswap/continuous-clearing-auction) (CCA), built on [viem](https://viem.sh).

It handles auction discovery, live state, Q96 price math, token metadata, and building `submitBid` transactions correctly. That last part covers the parts of the protocol that are easy to get wrong: ERC-20 bids go through Permit2, and bid prices must sit on a tick boundary.

> **Networks.** Ethereum (1), Base (8453), Unichain (130) and Arbitrum One (42161), plus Sepolia (11155111), Base Sepolia (84532) and Unichain Sepolia (1301). Reading is allowed everywhere; the SDK never signs. Use `isTestnet(chainId)` to gate anything that spends. Discovery covers every CCA factory version (v2.1.0, v2.0.0 and the deprecated v1.1.0), and token names and symbols are sanitised - they are attacker-controlled on-chain strings.

Built against the `ContinuousClearingAuctionFactory` **v1.1.0** at `0xCCccCcCAE7503Cac057829BF2811De42E16e0bD5`. The ABIs are compiled from upstream tag `v1.1.0`, not hand-written.

## Install

```bash
npm install @hammerock/cca-sdk viem
```

`viem` is a peer dependency, so your app and the SDK share one copy.

## Read an auction

```ts
import { createBeaconClient, getAuctionSummary, formatTokenAmount } from "@hammerock/cca-sdk";

const client = createBeaconClient({
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  chainId: 11155111,
});

const summary = await getAuctionSummary(client, "0x1e40451D6ecabA8640559b7dFbe63B41dA52460d");

console.log(summary.status);           // "pending" | "live" | "ended"
console.log(summary.clearingPrice);    // human-readable price
console.log(summary.state.isGraduated);
console.log(summary.secondsRemaining);
```

**No lens deployment needed.** Uniswap publishes no `CCALens` address. `getAuctionState` runs `AuctionStateLens` inside a single `eth_call` using a state override, so it works against any standard RPC. If you have deployed a lens yourself, pass `lensAddress` to `createBeaconClient`.

## Discover auctions

```ts
import { scanAuctions, watchAuctions } from "@hammerock/cca-sdk";

const auctions = await scanAuctions(client);            // every AuctionCreated since the factory deployed
const stop = watchAuctions(client, (a) => console.log("new auction", a.auction));
```

`eth_getLogs` is always chunked (50,000 blocks by default), halves the chunk size when a provider rejects a range, and re-queries empty chunks. Some public RPCs silently return an empty result for a range that has logs. Alchemy's free tier caps `eth_getLogs` at 10 blocks, so pass a separate `logsRpcUrl` for scanning.

## Place a bid

```ts
import {
  buildBidTransactions,
  checkBidReadiness,
  decimalToQ96,
  getAuctionInfo,
  getPrevTickHint,
} from "@hammerock/cca-sdk";

const info = await getAuctionInfo(client, auction);
const maxPriceQ96 = decimalToQ96("0.00000000000000000006");
const amount = 1_000_000_000_000_000n; // in the currency's smallest unit

const readiness = await checkBidReadiness(client, {
  auction,
  currency: info.currency,
  bidder,
  amount,
});

const steps = buildBidTransactions({
  auction,
  currency: info.currency,
  maxPriceQ96,
  amount,
  owner: bidder,
  readiness,
  prevTickPriceQ96: await getPrevTickHint(client, auction, maxPriceQ96),
  tickSpacing: info.tickSpacing,
});

for (const { label, request } of steps) {
  // Send each with your own wallet client, waiting for approvals to land first.
  await walletClient.sendTransaction({ ...request, account, chain });
}
```

`buildBidTransactions` returns only the steps that are actually needed:

| Currency | Transactions |
| --- | --- |
| Native ETH | `submitBid` with `value` equal to the amount |
| ERC-20 | `approve(Permit2)` → `Permit2.approve(token, auction)` → `submitBid` with `value` 0, skipping any approval already in place |

Things it handles for you, each of which reverts on-chain if done wrong:

- **ERC-20 bids go through Permit2.** The auction pulls funds with Permit2's `transferFrom`, so approving the auction directly does nothing.
- **Bid prices must be a multiple of `tickSpacing`**, or `submitBid` reverts with `TickPriceNotAtBoundary()`. Prices are snapped **down**, so a bidder's ceiling never rises.
- **Native bids must send `msg.value == amount` exactly**, and ERC-20 bids must send no value.

The SDK never signs or broadcasts anything. You send the returned requests with your own wallet.

## Settle bids (exit and claim)

Nothing in a CCA pays out automatically. `planSettlement` decides what each bid
needs and encodes the transactions, including the checkpoint hints
`exitPartiallyFilledBid` requires. Anyone may send them; funds always go to the
bid owner. Simulate before sending.

```ts
import {
  findBidIds,
  getAuctionInfo,
  getAuctionState,
  planSettlement,
  readSettleState,
} from "@hammerock/cca-sdk";

const info = await getAuctionInfo(client, auction);
const live = await getAuctionState(client, auction);
const state = await readSettleState(client, auction, {
  clearingPriceQ96: live.checkpoint.clearingPriceQ96,
  graduated: live.isGraduated,
  endBlock: info.endBlock,
});

const ids = await findBidIds(client, auction, owner); // reads bids directly - no logs needed
const plan = await planSettlement(client, auction, owner, ids, state);

for (const tx of plan.exits) {
  await client.publicClient.call({ to: tx.to, data: tx.data, account }); // simulate
  // ...then send tx.to / tx.data with your wallet
}
// After the exits land, plan again: freshly exited bids then appear in plan.claim.
```

The decision logic is pure and exported too: `decideBidAction` and
`computeExitHints` take plain data, so you can test or reuse them without a chain.

## Q96 prices

CCA prices are Q96 fixed-point numbers (value × 2⁹⁶).

```ts
import { decimalToQ96, q96ToDecimalString, formatQ96, formatQ96Compact } from "@hammerock/cca-sdk";

decimalToQ96("0.0001");          // truncates DOWN - safe for price caps
q96ToDecimalString(value, 18);   // exact, truncating
formatQ96(value);                // rounded for display
formatQ96Compact(value);         // "5.42118e-20" for very small prices
```

`cumulativeMps` tracks how much of the supply **schedule** has been released. It is **not** the amount sold: an auction that closes with no bids still reaches 100%. Use `totalCleared` and `currencyRaised` for what actually sold.

## Node-only helpers

Anything that touches the filesystem is in a separate entry point, so the main entry stays safe for browser bundles:

```ts
import { JsonAuctionStore, syncAuctions, enrichStore } from "@hammerock/cca-sdk/node";
```

## API overview

| Area | Exports |
| --- | --- |
| Client | `createBeaconClient`, `assertSupportedChain`, `assertChainMatches` |
| Read | `getAuctionState`, `getAuctionInfo`, `getAuctionSummary`, `getAuctionSummaries`, `getAuctionListStates`, `getClearingPrice`, `isGraduated`, `deriveStatus` |
| Discover | `scanAuctions`, `watchAuctions`, `scanAuctionsForToken`, `auctionCreatedEvent` |
| Write | `buildBidTransactions`, `encodeSubmitBid`, `checkBidReadiness`, `getPrevTickHint`, `alignPriceToTickBoundary`, `describeBidBlocker`, `encodeApproveErc20ToPermit2`, `encodeApprovePermit2` |
| Tokens | `getTokenMetadata`, `formatTokenAmount` |
| Q96 | `decimalToQ96`, `q96ToDecimalString`, `q96ToNumber`, `formatQ96`, `formatQ96Compact`, `mpsToFraction` |
| Auction config | `encodeAuctionParameters`, `decodeAuctionParameters`, `buildAuctionSteps`, `validateAuctionParameters` |
| ABIs | `auctionAbi`, `factoryAbi`, `auctionStateLensAbi`, `UPSTREAM_TAG`, `UPSTREAM_COMMIT` |
| Constants | `FACTORY_ADDRESS`, `PERMIT2_ADDRESS`, `NATIVE_CURRENCY`, `SUPPORTED_CHAINS` |

Full source, tests and the apps built on this SDK: [github.com/Shubham-Singh-Shoora/Beacon-](https://github.com/Shubham-Singh-Shoora/Beacon-).

## License

MIT
