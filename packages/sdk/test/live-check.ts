/**
 * Phase 1 definition-of-done: point the SDK at a real testnet and prove the
 * read side works end to end.
 *
 *   pnpm --filter @hammerock/cca-sdk check:live
 *
 * Discovers every auction the factory has ever created by scanning
 * `AuctionCreated`, then reads one auction's live state through
 * `AuctionStateLens.state()`.
 *
 * Reads configuration from the repo-root `.env`, falling back to the verified
 * Sepolia defaults, so it runs with no setup at all. Set BEACON_RPC_URL to an
 * archive-capable provider (e.g. Alchemy) to make the historical scan fast.
 *
 * This is a live network script, not a unit test - vitest ignores it because
 * the filename does not end in `.test.ts`.
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  assertChainMatches,
  createBeaconClient,
  formatMpsPercent,
  formatQ96,
  getAuctionInfo,
  getAuctionState,
  isFailedSummary,
  getAuctionSummaries,
  NATIVE_CURRENCY,
  requireFactoryDeployBlock,
  scanAuctions,
  UPSTREAM_COMMIT,
  UPSTREAM_TAG,
} from "../src/index";
import type { Address } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env"), quiet: true });

const RPC_URL = process.env.BEACON_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = Number(process.env.BEACON_CHAIN_ID ?? 11155111);
const LENS_ADDRESS = process.env.BEACON_LENS_ADDRESS as Address | undefined;

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

async function main(): Promise<void> {
  heading("Beacon SDK live check");
  console.log(`ABIs compiled from  : Uniswap/continuous-clearing-auction @ ${UPSTREAM_TAG}`);
  console.log(`                      ${UPSTREAM_COMMIT}`);
  console.log(`RPC                 : ${RPC_URL}`);

  const client = createBeaconClient({
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    // Undefined means "inject the lens via eth_call state override" - no deploy.
    lensAddress: LENS_ADDRESS && LENS_ADDRESS.length > 0 ? LENS_ADDRESS : undefined,
  });

  await assertChainMatches(client);

  const headBlock = await client.publicClient.getBlockNumber();
  const fromBlock = requireFactoryDeployBlock(client);
  console.log(`Chain               : ${client.chain.name} (${client.chainId})`);
  console.log(`Factory             : ${client.factoryAddress}`);
  console.log(`Lens                : ${client.lensAddress ?? "none deployed - using eth_call state override"}`);
  console.log(`Scanning blocks     : ${fromBlock} -> ${headBlock}`);

  heading("1. Discovering auctions via the factory's AuctionCreated event");

  const startedAt = Date.now();
  let lastLoggedPercent = -1;
  const auctions = await scanAuctions(client, {
    toBlock: headBlock,
    onProgress: ({ scannedTo, headBlock: head, found }) => {
      const span = Number(head - fromBlock);
      const done = Number(scannedTo - fromBlock);
      const percent = Math.floor((done / span) * 100);
      if (percent >= lastLoggedPercent + 10) {
        lastLoggedPercent = percent;
        console.log(`  ${String(percent).padStart(3)}%  scanned to ${scannedTo}  (${found} found)`);
      }
    },
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nFound ${auctions.length} auctions in ${elapsed}s.`);

  if (auctions.length === 0) {
    console.log("No auctions found - nothing further to read.");
    return;
  }

  const uniqueTokens = new Set(auctions.map((a) => a.token.toLowerCase()));
  console.log(`Across ${uniqueTokens.size} unique tokens.`);

  heading("2. Ten most recent auctions");
  for (const entry of auctions.slice(-10)) {
    console.log(
      `  block ${entry.blockNumber}  ${entry.auction}  token=${entry.token}  amount=${entry.amount}`,
    );
  }

  heading("3. Live state of the most recent auction (via AuctionStateLens.state)");

  const latest = auctions.at(-1)!;
  const [info, state] = await Promise.all([
    getAuctionInfo(client, latest.auction),
    getAuctionState(client, latest.auction),
  ]);

  const currency = info.currency === NATIVE_CURRENCY ? "native ETH" : info.currency;
  console.log(`  auction         : ${info.auction}`);
  console.log(`  token           : ${info.token}`);
  console.log(`  currency        : ${currency}`);
  console.log(`  total supply    : ${info.totalSupply}`);
  console.log(`  blocks          : ${info.startBlock} -> ${info.endBlock} (head ${headBlock})`);
  console.log(`  floor price     : ${formatQ96(info.floorPriceQ96)}  (Q96 ${info.floorPriceQ96})`);
  console.log("");
  console.log(`  clearing price  : ${formatQ96(state.checkpoint.clearingPriceQ96)}`);
  console.log(`  currency raised : ${state.currencyRaised}`);
  console.log(`  total cleared   : ${state.totalCleared}`);
  console.log(`  graduated       : ${state.isGraduated}`);
  console.log(
    `  supply schedule : ${formatMpsPercent(state.checkpoint.cumulativeMps)}% released ` +
      `(NOT "% sold" - see Checkpoint.cumulativeMps)`,
  );

  heading("4. Batch summaries for the five most recent auctions");

  const recent = auctions.slice(-5).map((a) => a.auction);
  const summaries = await getAuctionSummaries(client, recent);

  for (const summary of summaries) {
    if (isFailedSummary(summary)) {
      console.log(`  ${summary.auction}  FAILED: ${summary.error.message.split("\n")[0]}`);
      continue;
    }
    const remaining =
      summary.status === "live"
        ? `${summary.blocksRemaining} blocks (~${Math.round(summary.secondsRemaining / 60)} min)`
        : "-";
    console.log(
      `  ${summary.info.auction}  ${summary.status.padEnd(7)}  price=${summary.clearingPrice.padEnd(20)}  ` +
        `graduated=${String(summary.state.isGraduated).padEnd(5)}  remaining=${remaining}`,
    );
  }

  heading("Live check complete");
}

main().catch((error) => {
  console.error("\nLive check failed:\n", error);
  process.exitCode = 1;
});
