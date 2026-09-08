# Feedback

Required for hackathon qualification.

**Feedback form submission:** _<!-- PASTE THE SUBMISSION LINK HERE -->_

> Submitted at <https://developers.uniswap.org/hackathon-feedback>. The form has
> to be submitted from the team's own account, so the confirmation link is
> pasted in above by hand. Everything below is the content of that submission,
> kept in the repo so it is reviewable alongside the code.

Twelve findings from building four surfaces on the Continuous Clearing Auction
protocol. Each one cost us real debugging time, and each is reproducible from
this repo.

**The three that would help most, in order:**

1. Document that `submitBid` requires `maxPrice` on a tick boundary (#10) - it
   is the difference between a working integration and an opaque 4-byte revert.
2. Document that ERC-20 bids settle through Permit2, not a direct approval (#7).
3. Publish a `CCALens` address, or document the `eth_call` state-override
   pattern that removes the need for one (#1, #6).

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

## Phase 4: the write path

**7. `submitBid` pulling ERC-20 currency through Permit2 is undocumented and is
the biggest integration trap in the protocol.**
`submitBid` calls `SafeTransferLib.permit2TransferFrom` for any non-native
currency. Nothing in the NatSpec on `submitBid` mentions Permit2, so the
obvious integration - approve the auction, then bid - compiles, reads fine, and
reverts with an opaque `TransferFromFailed()`. We only found it by reading the
implementation. One line on `submitBid` saying "ERC-20 bids require a Permit2
allowance, not an ERC-20 approval to this contract" would save every integrator
the same debugging session.

**8. The `prevTickPrice` hint has no documented way to compute it.**
The parameter is described as "the previous tick price", and the no-hint
overload is documented as gas-expensive, but nothing explains how an off-chain
caller should derive a good hint. Reading the source shows the no-hint overload
simply passes `FLOOR_PRICE`, which is a useful thing to know: it means the hint
is purely a search optimisation and a conservative value is always safe. A
NatSpec line saying that would let integrators reason about it instead of
guessing.

**9. Minor: `submitBid` overload selection is easy to get wrong from a
TypeScript ABI.** The four- and five-argument overloads differ only in arity, so
an encoder picks between them by argument count. That is fine once you know, but
worth a note.

## Phase 5: deploying an auction

**10. `submitBid` requires `maxPrice` to be on a tick boundary, and this is not
documented.**
`TickStorage._getTick` reverts with `TickPriceNotAtBoundary()` for any price
that is not a multiple of `tickSpacing`. The NatSpec explains that rule for the
FLOOR price but not for bids, so the natural implementation - take the user's
price, convert to Q96, submit - reverts with a bare 4-byte selector. We only
found it by running against a forked Sepolia. Either documenting it on
`submitBid`, or having the contract snap the price down itself, would remove a
whole class of broken integrations.

**11. `onTokensReceived()` is a required step that is easy to miss.**
After `initializeDistribution` the auction exists and every view function
returns sensible values, but bids revert until the supply has been transferred
in AND `onTokensReceived()` has been called. Nothing in the factory's interface
hints that creation is a three-transaction process. A sentence on
`initializeDistribution` describing the full sequence would help.

**12. The supply schedule's exact-sum requirement is unforgiving.**
`sum(mps * blockDelta)` must equal `MPS` exactly and the block deltas must land
precisely on `endBlock`, but `MPS` (1e7) rarely divides evenly by a chosen
duration. Every integrator has to independently work out a remainder-handling
scheme or hit `InvalidStepDataMps`. A helper in the periphery that builds a
valid flat schedule from a duration would be a small, high-value addition.

## Reproducing these findings

Every claim above is exercised by code in this repo:

| Finding | Where it is demonstrated |
| --- | --- |
| #3 non-view `state()` | `packages/sdk/src/read.ts`, `packages/sdk/test/read.test.ts` |
| #6 lens via state override | `pnpm --filter @beacon/cca-sdk check:live` works with no lens deployed |
| #7 Permit2 for ERC-20 bids | `packages/sdk/test/write.test.ts` |
| #10 tick-boundary bid prices | `packages/sdk/test/write.test.ts` - the exact price that reverted |
| #11 `onTokensReceived()` | `packages/sdk/scripts/deploy-demo-auction.ts` step 4/4 |
| #12 schedule must sum to MPS | `buildAuctionSteps()` + `packages/sdk/test/auctionParameters.test.ts` |
