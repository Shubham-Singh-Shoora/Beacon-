import { useCallback, useEffect, useRef, useState } from "react";
import {
  createBeaconClient,
  deriveStatus,
  getAuctionInfo,
  getAuctionState,
  getTokenMetadata,
} from "@beacon/cca-sdk";
import type {
  Address,
  AuctionInfo,
  AuctionState,
  AuctionStatus,
  BeaconClient,
  TokenMetadata,
} from "@beacon/cca-sdk";

/**
 * Everything the card renders, read through @beacon/cca-sdk.
 *
 * The widget runs on somebody else's website, so it reads through whatever
 * public RPC the embedder passes in. It never needs a lens deployment: the SDK
 * runs `AuctionStateLens` through an `eth_call` state override.
 */
export interface AuctionData {
  info: AuctionInfo;
  state: AuctionState;
  token: TokenMetadata;
  currency: TokenMetadata;
  status: AuctionStatus;
  headBlock: bigint;
  blocksRemaining: bigint;
  secondsRemaining: number;
}

export interface UseAuctionResult {
  data: AuctionData | null;
  error: Error | null;
  loading: boolean;
  client: BeaconClient | null;
  refresh: () => void;
}

export function useAuction(options: {
  auction: Address;
  rpcUrl: string;
  chainId: number;
  lensAddress?: Address;
  pollIntervalMs?: number;
}): UseAuctionResult {
  const { auction, rpcUrl, chainId, lensAddress, pollIntervalMs = 12_000 } = options;

  const [data, setData] = useState<AuctionData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // Immutable per-auction data, cached across polls. Held in a ref rather than
  // read from `data` so the polling effect does not need `data` as a
  // dependency - which would restart the timer on every tick.
  const staticRef = useRef<{
    info?: AuctionInfo;
    token?: TokenMetadata;
    currency?: TokenMetadata;
  }>({});

  /** Set once the auction has closed, so polling can stop. */
  const endedAtRef = useRef(false);

  const clientRef = useRef<BeaconClient | null>(null);
  if (!clientRef.current) {
    try {
      clientRef.current = createBeaconClient({ rpcUrl, chainId, lensAddress });
    } catch {
      clientRef.current = null;
    }
  }

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) {
      setError(new Error(`Unsupported or non-testnet chain id ${chainId}.`));
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load(isInitial: boolean) {
      try {
        if (isInitial) setLoading(true);

        const [info, state, headBlock] = await Promise.all([
          // Config is immutable, so only read it once.
          staticRef.current.info ?? getAuctionInfo(client!, auction),
          getAuctionState(client!, auction),
          client!.publicClient.getBlockNumber(),
        ]);

        const [token, currency] = await Promise.all([
          staticRef.current.token ?? getTokenMetadata(client!, info.token),
          staticRef.current.currency ?? getTokenMetadata(client!, info.currency),
        ]);

        staticRef.current = { info, token, currency };

        if (cancelled) return;

        const status = deriveStatus(info, headBlock);
        endedAtRef.current = status === "ended";
        const blocksRemaining =
          status === "pending"
            ? info.startBlock - headBlock
            : status === "live"
              ? info.endBlock - headBlock
              : 0n;

        setData({
          info,
          state,
          token,
          currency,
          status,
          headBlock,
          blocksRemaining,
          secondsRemaining: Number(blocksRemaining) * client!.blockTimeSeconds,
        });
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load(true);

    // An ended auction cannot change, so stop polling once it has closed.
    const timer = setInterval(() => {
      if (staticRef.current.info && endedAtRef.current) {
        clearInterval(timer);
        return;
      }
      void load(false);
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [auction, chainId, pollIntervalMs, nonce]);

  return { data, error, loading, client: clientRef.current, refresh };
}
