"use client";
import { useEffect, useState } from "react";
import { formatQ96, formatQ96Compact, formatTokenAmount, mpsToFraction } from "@hammerock/cca-sdk";
import type { TokenMetadata } from "@hammerock/cca-sdk";
import { ScheduleProgress } from "./Badges";

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
  chainSlug,
  networkName,
  token,
  currency,
  initial,
  pollIntervalMs = 12000,
  isEnded,
}: {
  auction: string;
  chainSlug: string;
  networkName: string;
  token: TokenMetadata;
  currency: TokenMetadata;
  initial: LiveStateResponse;
  pollIntervalMs?: number;
  isEnded: boolean;
}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (isEnded) return;
    const controller = new AbortController();
    let inFlight = false;
    async function poll() {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const response = await fetch(`/api/auctions/${auction}?chain=${chainSlug}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Refresh unavailable");
        const next = (await response.json()) as LiveStateResponse;
        if (!controller.signal.aborted) {
          setData(next);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        inFlight = false;
      }
    }
    const timer = setInterval(poll, pollIntervalMs);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [auction, chainSlug, pollIntervalMs, isEnded]);
  return (
    <section className="panel price-panel">
      <div className="panel-heading">
        <h2>{isEnded ? "Final auction outcome" : "Auction overview"}</h2>
        <span>
          <span className={isEnded ? "quiet-dot" : "network-dot"} />
          {isEnded ? "Auction closed" : "Updates every 12 seconds"}
        </span>
      </div>
      <div className="price-label">
        {isEnded ? "Final clearing price" : "Current clearing price"}
      </div>
      <div className="main-price" title={formatQ96(BigInt(data.clearingPriceQ96))}>
        {formatQ96Compact(BigInt(data.clearingPriceQ96))}
      </div>
      <div className="price-unit">
        {currency.symbol} per {token.symbol}
      </div>
      <div className="price-divider" />
      <dl className="state-metrics">
        <div>
          <dt>Total raised</dt>
          <dd>
            {formatTokenAmount(BigInt(data.currencyRaised), currency)}
            <small>Committed bid currency</small>
          </dd>
        </div>
        <div>
          <dt>Tokens cleared</dt>
          <dd>
            {formatTokenAmount(BigInt(data.totalCleared), token)}
            <small>
              {BigInt(data.totalCleared) > 0n
                ? "Supply distributed through the auction"
                : "No supply has cleared"}
            </small>
          </dd>
        </div>
        <div>
          <dt>Graduation</dt>
          <dd className="graduation-value">
            {data.isGraduated ? "Graduated ↗" : isEnded ? "Did not graduate" : "Not yet graduated"}
            <small>
              {data.isGraduated
                ? "The graduation threshold was reached"
                : "The graduation threshold was not reached"}
            </small>
          </dd>
        </div>
        <div>
          <dt>Network block</dt>
          <dd>
            {BigInt(data.headBlock).toLocaleString("en-US")}
            <small>{networkName}</small>
          </dd>
        </div>
      </dl>
      <div className="schedule-block">
        <div className="schedule-heading">
          <span>Supply schedule released</span>
          <span>{isEnded ? "Final schedule" : "Auction progress"}</span>
        </div>
        <ScheduleProgress progress={mpsToFraction(data.cumulativeMps)} />
        <p>
          This tracks the supply released by the schedule. Tokens cleared above shows how much
          actually sold.
        </p>
      </div>
      {error && (
        <p className="notice" role="status">
          Network updates are temporarily unavailable. Showing the last successful read.
        </p>
      )}
    </section>
  );
}
