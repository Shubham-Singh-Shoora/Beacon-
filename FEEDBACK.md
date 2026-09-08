# Feedback

Required for hackathon qualification.

Submission to the Uniswap developer feedback form: **TODO(phase-6)** - link the
completed submission at <https://developers.uniswap.org/hackathon-feedback>.

Running notes on the CCA developer experience, collected while building Beacon.

## Pre-Phase-1: integrating against the deployed contracts

**1. No `CCALens` address is published, on any network.**
The deployments page lists `ContinuousClearingAuctionFactory` and
`LiquidityLauncher` but omits the lens entirely. Since the lens is the
contract the docs point integrators at for off-chain reads, every integrator
has to independently discover that they must deploy their own copy. A published
address (or an explicit "deploy your own" note) would remove a real stumbling
block.

**2. The deployed factory is v1.1.0, but `CCALens` only exists from v2.x.**
This is a trap. `CCALens` is `Multicallable + AuctionStateLens + TickDataLens`.
Against a v1.1.0 auction the `AuctionStateLens` half works fine, but
`TickDataLens` calls `remainingSupplyQ96X7()`, which does not exist on v1.1.0
auctions - so half the lens silently fails. Nothing in the docs signals that the
lens and the deployed factory are on different versions. Tagging the lens
sources with the auction version they support, or publishing a v1.1.0-compatible
lens, would help.

**3. `AuctionStateLens.state()` is not `view`, and that is not obvious.**
It calls `auction.checkpoint()` (state-mutating) and returns its result by
reverting with ABI-encoded data. It is a neat trick, but it means integrators
must call it with `eth_call` simulation semantics - `simulateContract` in viem,
`callStatic` in ethers - and a naive `readContract` fails. A one-line note in
the lens NatSpec saying "call via eth_call only" would save time.

**4. No deployment block numbers are published.**
Anyone indexing `AuctionCreated` needs the factory's creation block to know
where to start scanning. We had to recover it from the creation transaction
(Sepolia block `10130119`). Listing it next to the address would be cheap.

**5. Minor: `submitBid` parameter names drifted between versions.**
v1.1.0 uses `maxPrice` / `prevTickPrice`; v2.x renames them to `maxPriceQ96` /
`prevTickPriceQ96`. Same types, same selector, so it is harmless - but the
newer names are clearer about the Q96 encoding and are worth backporting into
the docs, since the Q96 fixed-point convention is the single easiest thing for
a new integrator to get wrong.

**6. The lens is trivially usable without deploying it, and that is worth documenting.**
Because `AuctionStateLens` is stateless and its `state()` is already invoked with
`eth_call` semantics, an integrator can inject its compiled runtime bytecode with
an `eth_call` state override and skip deployment entirely. Beacon does this by
default, so `pnpm check:live` reads live auction state against a bare public RPC
with no deployment, no funded wallet and no setup. Given that no lens address is
published, suggesting this pattern in the docs would remove the single biggest
onboarding blocker we hit.

## Later phases

- _(Phase 2)_ -
- _(Phase 3)_ -
- _(Phase 4)_ -
- _(Phase 5)_ -
