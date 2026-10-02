/** Read everything the auction card shows, in parallel where possible. */
import { deriveStatus, getAuctionInfo, getAuctionState, getTokenMetadata } from "@hammerock/cca-sdk";
import type { BeaconClient } from "@hammerock/cca-sdk";
import type { Address } from "viem";
import type { AuctionView } from "./ui";

export async function readAuctionView(client: BeaconClient, auction: Address): Promise<AuctionView> {
  const [info, state, headBlock] = await Promise.all([
    getAuctionInfo(client, auction),
    getAuctionState(client, auction),
    client.publicClient.getBlockNumber(),
  ]);
  const [token, currency] = await Promise.all([
    getTokenMetadata(client, info.token),
    getTokenMetadata(client, info.currency),
  ]);
  return {
    info,
    state,
    token,
    currency,
    status: deriveStatus(info, headBlock),
    headBlock,
    secondsPerBlock: client.blockTimeSeconds,
    chainName: client.chain.name,
  };
}
