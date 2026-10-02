"use client";

import { AuctionCard } from "@hammerock/cca-widget";
import type { Address } from "viem";

/**
 * Renders the real embeddable widget inside the directory's detail page.
 *
 * Note `rpcUrl` is the chain's PUBLIC endpoint, never a keyed BEACON_RPC_URL.
 * The widget runs in the visitor's browser, so it must never be handed a key -
 * and a real embedder on their own site would pass their own public RPC too.
 */
export function WidgetPreview({
  auction,
  chainId,
  rpcUrl,
}: {
  auction: Address;
  chainId: number;
  rpcUrl: string;
}) {
  return (
    <div className="widget-shell">
      <AuctionCard auction={auction} chainId={chainId} rpcUrl={rpcUrl} />
    </div>
  );
}
