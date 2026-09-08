"use client";

import { useEffect, useState } from "react";
import { formatQ96, formatQ96Compact, formatTokenAmount, mpsToFraction } from "@beacon/cca-sdk";
import type { TokenMetadata } from "@beacon/cca-sdk";
import { ScheduleProgress } from "./Badges";

/**
 * Polls our own API route for fresh auction state.
 *
 * Polls the server, not the RPC provider: BEACON_RPC_URL carries an API key and
 * must stay server-side. Formatting comes from the SDK, so the numbers here are
 * rendered by exactly the same code as the bot and the widget.
 */

interface LiveStateResponse {
  clearingPriceQ96: string;
  cumulativeMps: number;
  currencyRaised: string;
  totalCleared: string;
  isGraduated: boolean;
  headBlock: string;
  readAt: string;
}

export function LiveState({
  auction,
  token,
  currency,
  initial,
  pollIntervalMs = 12_000,
  isEnded,
}: {
  auction: string;
  token: TokenMetadata;
  currency: TokenMetadata;
  initial: LiveStateResponse;
  pollIntervalMs?: number;
  isEnded: boolean;
}) {
  const [data, setData] = useState<LiveStateResponse>(initial);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>(initial.readAt);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/auctions/${auction}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = (await response.json()) as LiveStateResponse;
        if (cancelled) return;
        setData(next);
        setUpdatedAt(next.readAt);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    }

    // An ended auction's state cannot change, so polling it forever is waste.
    if (isEnded) return;

    const timer = setInterval(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [auction, pollIntervalMs, isEnded]);

  const hasCleared = BigInt(data.totalCleared) > 0n;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Live state
        </h2>
        <span className="text-xs text-neutral-600">
          {isEnded
            ? "final — auction closed"
            : `updated ${new Date(updatedAt).toLocaleTimeString()}`}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* The symbol pair lives in the value, not the label: the label is
            CSS-uppercased, which would turn "tUSDC" into "TUSDC". */}
        <Field label="Clearing price">
          <span className="tabular-nums" title={formatQ96(BigInt(data.clearingPriceQ96))}>
            {formatQ96Compact(BigInt(data.clearingPriceQ96))}
          </span>{" "}
          <span className="text-neutral-500">
            {currency.symbol} per {token.symbol}
          </span>
        </Field>

        <Field label="Graduated">
          {data.isGraduated ? (
            <span className="text-violet-300">Yes — raised enough to seed the pool</span>
          ) : (
            <span className="text-neutral-400">No</span>
          )}
        </Field>

        <Field label="Raised">
          <span className="tabular-nums">
            {formatTokenAmount(BigInt(data.currencyRaised), currency)}
          </span>
        </Field>

        <Field label="Cleared">
          {hasCleared ? (
            <span className="tabular-nums">
              {formatTokenAmount(BigInt(data.totalCleared), token)}
            </span>
          ) : (
            <span className="text-neutral-500">Nothing cleared</span>
          )}
        </Field>

        <Field label="Supply schedule released">
          <div className="flex items-center gap-3">
            <ScheduleProgress progress={mpsToFraction(data.cumulativeMps)} />
          </div>
          <p className="mt-1.5 text-xs text-neutral-600">
            How much of the supply schedule has been released — not the amount sold. An auction
            that closes with no bids still reaches 100%.
          </p>
        </Field>

        <Field label="Chain head">
          <span className="tabular-nums text-neutral-400">{data.headBlock}</span>
        </Field>
      </dl>

      {error ? (
        <p className="mt-4 text-xs text-amber-400/80">
          Could not refresh ({error}) — showing the last successful read.
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-100">{children}</dd>
    </div>
  );
}
