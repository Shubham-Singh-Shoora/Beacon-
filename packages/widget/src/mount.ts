/**
 * Vanilla-JS entry point so non-React sites can embed the widget with a
 * <script> tag:
 *
 *   <div id="beacon"></div>
 *   <script src="https://.../mount.global.js"></script>
 *   <script>BeaconCCA.mount('#beacon', { auction: '0x...', chainId: 84532, rpcUrl: '...' })</script>
 *
 * TODO(phase-3): createRoot + render <AuctionCard/> into the target element.
 */
import type { AuctionCardProps } from "./AuctionCard";

export function mount(_target: string | HTMLElement, _props: AuctionCardProps): void {
  throw new Error("Beacon widget: mount() is implemented in Phase 3.");
}
