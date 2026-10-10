/** Operational adapter: provider limits and atomic persistence stay outside the SDK. */
import { copyFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertChainMatches,
  createBeaconClient,
  networkBySlug,
  rpcSettingsFromEnv,
} from "../../packages/sdk/src/index";
import { enrichStore, JsonAuctionStore, syncAuctions } from "../../packages/sdk/src/node";
import type { AuctionStore, StoreUpdate } from "../../packages/sdk/src/node";

export class AtomicStore implements AuctionStore {
  constructor(private readonly path: string) {}
  read() {
    return new JsonAuctionStore(this.path).read();
  }
  async merge(update: StoreUpdate) {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await copyFile(this.path, temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      const result = await new JsonAuctionStore(temporary).merge(update);
      await rename(temporary, this.path);
      return result;
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

async function main() {
  const network = networkBySlug(process.argv[2] ?? "");
  if (!network) throw new Error("A supported chain slug is required.");
  const configuredChunk = process.env[`BEACON_SYNC_CHUNK_SIZE_${network.chainId}`];
  if (configuredChunk && !/^[1-9]\d*$/.test(configuredChunk))
    throw new Error("BEACON_SYNC_CHUNK_SIZE must be a positive integer.");
  const chunkSize = configuredChunk
    ? BigInt(configuredChunk)
    : network.chainId === 8453
      ? 500n
      : network.logChunkSize;
  const settings = rpcSettingsFromEnv(network.chainId);
  const client = createBeaconClient({
    chainId: network.chainId,
    ...settings,
    logChunkSize: chunkSize,
  });
  await assertChainMatches(client);
  if ((await client.logsClient.getChainId()) !== network.chainId)
    throw new Error("The log provider is serving the wrong chain.");
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const store = new AtomicStore(resolve(repoRoot, `data/auctions.${network.slug}.json`));
  const before = await store.read();
  console.log(
    `${network.name}: ${before?.auctions.length ?? 0} auctions; checkpoint ${before?.lastSyncedBlock ?? "none"}; ${chunkSize}-block requests`,
  );
  const result = await syncAuctions(client, store, {
    chunkSize,
    onProgress: (message) => console.log(message),
  });
  console.log(
    `added ${result.added}, total ${result.total}, scanned ${result.scannedFrom}->${result.scannedTo} via ${result.source}`,
  );
  const enriched = await enrichStore(client, store);
  console.log(
    `enriched ${enriched.enriched}, already complete ${enriched.alreadyComplete}, failed ${enriched.failed}, total ${enriched.total}`,
  );
  if (enriched.failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    // Provider URLs can include credentials. Keep diagnostics to a redacted first line.
    const message = error instanceof Error ? error.message.split("\n")[0]! : "Unknown sync error";
    console.error(message.replace(/https?:\/\/\S+/g, "[RPC URL redacted]"));
    process.exitCode = 1;
  });
