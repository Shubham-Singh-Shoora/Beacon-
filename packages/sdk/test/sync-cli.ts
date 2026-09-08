/**
 * Backfill / refresh the auction store.
 *
 *   pnpm --filter @beacon/cca-sdk sync            incremental
 *   pnpm --filter @beacon/cca-sdk sync -- --full --passes 3   converge a full rescan
 *
 * Uses BEACON_LOGS_RPC_URL for scanning (needs wide eth_getLogs ranges) and
 * BEACON_RPC_URL for everything else.
 */
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBeaconClient } from "../src/index";
import { enrichStore, JsonAuctionStore, syncAuctions } from "../src/node";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
loadEnv({ path: resolve(repoRoot, ".env"), quiet: true });

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};

const rpcUrl = process.env.BEACON_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const logsRpcUrl =
  process.env.BEACON_LOGS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const storePath = resolve(repoRoot, process.env.BEACON_STORE_PATH ?? "data/auctions.sepolia.json");

const client = createBeaconClient({
  rpcUrl,
  logsRpcUrl,
  chainId: Number(process.env.BEACON_CHAIN_ID ?? 11155111),
});

console.log(`state rpc : ${new URL(rpcUrl).host}`);
console.log(`logs  rpc : ${new URL(logsRpcUrl).host}`);
console.log(`store     : ${storePath}`);

const store = new JsonAuctionStore(storePath);
const before = await store.read();
console.log(`before    : ${before?.auctions.length ?? 0} auctions, watermark ${before?.lastSyncedBlock ?? "none"}`);

if (!flag("no-scan")) {
  const result = await syncAuctions(client, store, {
    full: flag("full"),
    passes: value("passes", 1),
    onProgress: (m) => console.log(`  ${m}`),
  });

  console.log(
    `\nadded ${result.added}, total ${result.total}, scanned ${result.scannedFrom}->${result.scannedTo}`,
  );
  if (result.anomalies > 0) {
    console.log(
      `WARNING: ${result.anomalies} false-empty log chunk(s) recovered on retry - this endpoint is unreliable.`,
    );
  }
}

// Cache each auction's immutable config + token metadata so the directory can
// render status and currency labels without any RPC calls.
if (!flag("no-enrich")) {
  console.log("");
  console.log("enriching store with auction config + token metadata...");
  const enriched = await enrichStore(client, store, { onProgress: (m) => console.log(`  ${m}`) });
  console.log(
    `enriched ${enriched.enriched}, already complete ${enriched.alreadyComplete}, failed ${enriched.failed}, total ${enriched.total}`,
  );
}
