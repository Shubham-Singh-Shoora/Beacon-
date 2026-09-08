/**
 * Live auction state for the detail page's client-side polling.
 *
 * This exists so the browser never sees BEACON_RPC_URL, which carries an API
 * key. The client polls this route; the route talks to the chain.
 */
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import type { Address } from "viem";
import { getLiveState } from "@/lib/beacon";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;

  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const { state, headBlock } = await getLiveState(address as Address);
    return NextResponse.json({
      // bigints are not JSON-serializable, so everything crosses as a string.
      clearingPriceQ96: state.checkpoint.clearingPriceQ96.toString(),
      cumulativeMps: state.checkpoint.cumulativeMps,
      currencyRaised: state.currencyRaised.toString(),
      totalCleared: state.totalCleared.toString(),
      isGraduated: state.isGraduated,
      headBlock: headBlock.toString(),
      readAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message.split("\n")[0] },
      { status: 502 },
    );
  }
}
