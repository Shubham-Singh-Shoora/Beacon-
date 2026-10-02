/**
 * Live auction state for the detail page's client-side polling.
 *
 * This exists so the browser never sees BEACON_RPC_URL, which carries an API
 * key. The client polls this route; the route talks to the chain.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import type { Address } from "viem";
import { findAuctionNetwork, getLiveState, resolveNetwork } from "@/lib/beacon";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const { address } = await context.params;

  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    // ?chain=<slug>; without it, the chain whose store holds this auction.
    const chain = new URL(request.url).searchParams.get("chain") ?? undefined;
    const network = chain ? resolveNetwork(chain) : ((await findAuctionNetwork(address as Address)) ?? resolveNetwork(undefined));
    const { state, headBlock } = await getLiveState(network, address as Address);
    return NextResponse.json({
      // bigints are not JSON-serializable, so everything crosses as a string.
      clearingPriceQ96: state.checkpoint.clearingPriceQ96.toString(),
      cumulativeMps: state.checkpoint.cumulativeMps,
      currencyRaised: state.currencyRaised.toString(),
      totalCleared: state.totalCleared.toString(),
      isGraduated: state.isGraduated,
      headBlock: headBlock.toString(),
      chainId: network.chainId,
      readAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Auction data is temporarily unavailable. Please try again." },
      { status: 502 },
    );
  }
}
