/**
 * The embeddable component: live auction state + bid form.
 *
 * TODO(phase-3): live clearing price, time left, bid depth via @beacon/cca-sdk.
 * TODO(phase-4): wire the bid form to the SDK's submitBid.
 */
export interface AuctionCardProps {
  /** Address of the ContinuousClearingAuction to display. */
  auction: `0x${string}`;
  /** RPC endpoint to read from. */
  rpcUrl: string;
  /** Chain id the auction lives on. */
  chainId: number;
  /** Poll interval for live state, in ms. Defaults to 12s in Phase 3. */
  pollIntervalMs?: number;
}

export function AuctionCard(props: AuctionCardProps) {
  return (
    <div data-beacon-auction={props.auction}>
      <p>Beacon widget stub — live auction state lands in Phase 3.</p>
    </div>
  );
}
