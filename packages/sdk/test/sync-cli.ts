/**
 * Backfill / refresh the auction stores - one JSON file per chain in data/.
 *
 *   pnpm sync:auctions                          the chain in BEACON_CHAIN_ID (default Sepolia)
 *   pnpm sync:auctions -- --chain base          one chain, by slug or id
 *   pnpm sync:auctions -- --chain mainnets      Ethereum, Base, Unichain, Arbitrum
 *   pnpm sync:auctions -- --chain all           every supported chain
 *   pnpm sync:auctions -- --full --passes 3     force a full rescan and converge
 *
 * RPCs come from BEACON_RPC_URL_<id> / BEACON_FALLBACK_RPC_URL_<id> /
 * BEACON_LOGS_RPC_URL_<id>, else the chain's free default (see networks.ts).
 * History the free RPC will not serve is backfilled from Blockscout.
 *
 * Exits non-zero if any chain fails, after trying all of them - the scheduled
 * GitHub Action relies on that.
 */
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBeaconClient, NETWORKS, networkBySlug, rpcSettingsFromEnv } from "../src/index";
import type { NetworkDefaults } from "../src/index";
import { enrichStore, JsonAuctionStore, syncAuctions } from "../src/node";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
loadEnv({ path: resolve(repoRoot, ".env"), quiet: true });

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

function selectChains(selector: string | undefined): NetworkDefaults[] {
  const all = Object.values(NETWORKS);
  if (!selector) {
    const id = Number(process.env.BEACON_CHAIN_ID ?? 11155111);
    const network = NETWORKS[id];
    if (!network) throw new Error(`BEACON_CHAIN_ID ${id} is not supported.`);
    return [network];
  }
  if (selector === "all") return all;
  if (selector === "mainnets") return all.filter((n) => !n.testnet);
  if (selector === "testnets") return all.filter((n) => n.testnet);
  return selector.split(",").map((part) => {
    const network = networkBySlug(part) ?? NETWORKS[Number(part)];
    if (!network) throw new Error(`Unknown chain "${part}". Use a slug (${all.map((n) => n.slug).join(", ")}) or id.`);
    return network;
  });
}

/** Store file for a chain. The Sepolia path is kept for existing deployments. */
export function storePathFor(network: NetworkDefaults): string {
  return resolve(repoRoot, `data/auctions.${network.slug}.json`);
}

async function syncChain(network: NetworkDefaults): Promise<void> {
  const settings = rpcSettingsFromEnv(network.chainId);
  const client = createBeaconClient({ chainId: network.chainId, ...settings });
  const store = new JsonAuctionStore(storePathFor(network));

  console.log(`\n=== ${network.name} (${network.chainId})`);
  console.log(`rpc       : ${new URL(settings.rpcUrl).host}${settings.fallbackRpcUrls.length ? ` (+${settings.fallbackRpcUrls.length} fallback)` : ""}`);
  const before = await store.read();
  console.log(`before    : ${before?.auctions.length ?? 0} auctions, watermark ${before?.lastSyncedBlock ?? "none"}`);

  if (!flag("no-scan")) {
    const result = await syncAuctions(client, store, {
      full: flag("full"),
      passes: Number(arg("passes") ?? 1),
      onProgress: (m) => console.log(`  ${m}`),
    });
    console.log(
      `added ${result.added}, total ${result.total}, scanned ${result.scannedFrom}->${result.scannedTo} via ${result.source}`,
    );
    if (result.anomalies > 0) {
      console.log(`WARNING: ${result.anomalies} false-empty log chunk(s) recovered on retry.`);
    }
  }

  // Cache each auction's immutable config + token metadata so the directory can
  // render without RPC calls.
  if (!flag("no-enrich")) {
    const enriched = await enrichStore(client, store, {
      onProgress: (m) => (m.endsWith("0") || m.includes("/") ? undefined : console.log(`  ${m}`)),
    });
    console.log(
      `enriched ${enriched.enriched}, already complete ${enriched.alreadyComplete}, failed ${enriched.failed}, total ${enriched.total}`,
    );
  }
}

const chains = selectChains(arg("chain"));
const failures: string[] = [];
for (const network of chains) {
  try {
    await syncChain(network);
  } catch (error) {
    console.error(`FAILED ${network.name}: ${(error as Error).message.split("\n")[0]}`);
    failures.push(network.name);
  }
}
if (failures.length > 0) {
  console.error(`\n${failures.length} chain(s) failed: ${failures.join(", ")}`);
  process.exitCode = 1;
}
