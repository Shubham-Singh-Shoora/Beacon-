# ABIs

Populated in Phase 1 from [Uniswap/continuous-clearing-auction](https://github.com/Uniswap/continuous-clearing-auction) (MIT).

Three ABIs are needed:

- `ContinuousClearingAuction` — `submitBid`, `clearingPrice`, `isGraduated`, events
- `CCALens` — `state(auction)` and tick reads
- `ContinuousClearingAuctionFactory` — the `AuctionCreated` event

These are **copied, not hand-written**, and the contracts themselves are never modified.
