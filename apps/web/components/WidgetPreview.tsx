"use client";

import { AuctionCard } from "@beacon/cca-widget";
import type { Address } from "viem";

/**
 * Renders the real embeddable widget inside the directory's detail page.
 *
 * Note this uses a PUBLIC rpc url, not BEACON_RPC_URL. The widget runs in the
 * visitor's browser, so it must never be handed a keyed endpoint - and a real
 * embedder on their own site would pass their own public RPC here too.
 */
export function WidgetPreview({ auction, chainId }: { auction: Address; chainId: number }) {
  const rpcUrl =
    process.env.NEXT_PUBLIC_BEACON_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

  return <AuctionCard auction={auction} chainId={chainId} rpcUrl={rpcUrl} />;
}
