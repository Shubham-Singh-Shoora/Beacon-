/**
 * Fill in the immutable detail the directory needs, once, and cache it.
 *
 * An auction's configuration (start/end block, token, currency, supply, floor
 * price) and its token/currency metadata (symbol, decimals) can never change.
 * Reading them on every page load would be hundreds of wasted RPC calls, so
 * they are fetched once here and persisted by the store.
 */
import { getTokenMetadata } from "./erc20";
import { getAuctionInfo } from "./read";
import type { BeaconClient } from "./client";
import type { TokenMetadata } from "./erc20";
import type { AuctionRecord, AuctionStore } from "./store";
import type { Address } from "./types";

export interface EnrichResult {
  enriched: number;
  alreadyComplete: number;
  failed: number;
  total: number;
}

export async function enrichStore(
  client: BeaconClient,
  store: AuctionStore,
  options: { concurrency?: number; retries?: number; onProgress?: (message: string) => void } = {},
): Promise<EnrichResult> {
  const snapshot = await store.read();
  if (!snapshot) {
    return { enriched: 0, alreadyComplete: 0, failed: 0, total: 0 };
  }

  const needsWork = snapshot.auctions.filter(
    (record) => !record.info || !record.tokenMeta || !record.currencyMeta,
  );
  const alreadyComplete = snapshot.auctions.length - needsWork.length;

  if (needsWork.length === 0) {
    return { enriched: 0, alreadyComplete, failed: 0, total: snapshot.auctions.length };
  }

  options.onProgress?.(
    `${needsWork.length} auction(s) need enrichment, ${alreadyComplete} already complete`,
  );

  // Token metadata repeats across auctions, so resolve each address once.
  const metadataCache = new Map<string, TokenMetadata>();
  const metadata = async (address: Address): Promise<TokenMetadata> => {
    const key = address.toLowerCase();
    const cached = metadataCache.get(key);
    if (cached) return cached;
    const fetched = await getTokenMetadata(client, address);
    metadataCache.set(key, fetched);
    return fetched;
  };

  const concurrency = options.concurrency ?? 5;
  const retries = options.retries ?? 4;
  const updated: AuctionRecord[] = [];
  let failed = 0;

  for (let i = 0; i < needsWork.length; i += concurrency) {
    const batch = needsWork.slice(i, i + concurrency);
    const settled = await Promise.all(
      batch.map(async (record): Promise<AuctionRecord | null> => {
        // Free public RPCs rate-limit bursts (Base's official endpoint failed
        // ~90% of a 5-wide burst, yet every read succeeds on its own), so back
        // off and retry before counting a record as failed.
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const info = record.info ?? (await getAuctionInfo(client, record.auction));
            const [tokenMeta, currencyMeta] = await Promise.all([
              record.tokenMeta ?? metadata(info.token),
              record.currencyMeta ?? metadata(info.currency),
            ]);
            return { ...record, info, tokenMeta, currencyMeta };
          } catch {
            if (attempt < retries) await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
          }
        }
        return null;
      }),
    );

    for (const record of settled) {
      if (record) updated.push(record);
      else failed++;
    }

    options.onProgress?.(
      `enriched ${updated.length}/${needsWork.length}${failed > 0 ? ` (${failed} failed)` : ""}`,
    );
  }

  if (updated.length > 0) {
    await store.merge({
      chainId: snapshot.chainId,
      factoryAddress: snapshot.factoryAddress,
      factoryAddresses: snapshot.factoryAddresses,
      lastSyncedBlock: snapshot.lastSyncedBlock,
      auctions: updated,
    });
  }

  return {
    enriched: updated.length,
    alreadyComplete,
    failed,
    total: snapshot.auctions.length,
  };
}
