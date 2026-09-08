import Link from "next/link";
import { notFound } from "next/navigation";
import { isAddress } from "viem";
import type { Address } from "viem";
import { formatQ96, formatQ96Compact, formatTokenAmount } from "@beacon/cca-sdk";
import { getAuctionDetail, explorerUrl } from "@/lib/beacon";
import { GraduationBadge, StatusBadge } from "@/components/Badges";
import { LiveState } from "@/components/LiveState";
import { WidgetPreview } from "@/components/WidgetPreview";

export const dynamic = "force-dynamic";

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default async function AuctionPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isAddress(address)) notFound();

  let detail;
  try {
    detail = await getAuctionDetail(address as Address);
  } catch {
    notFound();
  }
  if (!detail) notFound();

  const { entry, summary } = detail;
  const { info, token, currency, status } = entry;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← All auctions
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{token.symbol}</h1>
            <StatusBadge status={status} />
            <GraduationBadge isGraduated={summary.state.isGraduated} status={status} />
          </div>
          <p className="mt-1 text-neutral-400">{token.name}</p>
        </div>

        <a
          href={explorerUrl(`/address/${entry.auction}`)}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-neutral-800 px-3 py-1.5 font-mono text-xs text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
        >
          {entry.auction}
        </a>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <LiveState
            auction={entry.auction}
            token={token}
            currency={currency}
            isEnded={status === "ended"}
            initial={{
              clearingPriceQ96: summary.state.checkpoint.clearingPriceQ96.toString(),
              cumulativeMps: summary.state.checkpoint.cumulativeMps,
              currencyRaised: summary.state.currencyRaised.toString(),
              totalCleared: summary.state.totalCleared.toString(),
              isGraduated: summary.state.isGraduated,
              headBlock: summary.blockNumber.toString(),
              readAt: new Date().toISOString(),
            }}
          />

          <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
              Configuration
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Detail label="Token">
                <ExplorerLink address={info.token} label={`${token.symbol} (${token.decimals}dp)`} />
              </Detail>
              <Detail label="Bid currency">
                {currency.isNative ? (
                  <span>
                    {currency.symbol} <span className="text-neutral-500">(native)</span>
                  </span>
                ) : (
                  <ExplorerLink
                    address={info.currency}
                    label={`${currency.symbol} (ERC-20, ${currency.decimals}dp)`}
                  />
                )}
              </Detail>
              <Detail label="Supply offered">
                {formatTokenAmount(info.totalSupply, token)}
              </Detail>
              <Detail label="Floor price">
                <span className="tabular-nums" title={formatQ96(info.floorPriceQ96)}>
                  {formatQ96Compact(info.floorPriceQ96)}
                </span>{" "}
                <span className="text-neutral-500">{currency.symbol}</span>
              </Detail>
              <Detail label="Auction window">
                <span className="tabular-nums">
                  {info.startBlock.toString()} → {info.endBlock.toString()}
                </span>
                <div className="text-xs text-neutral-500">
                  {status === "live"
                    ? `~${formatDuration(summary.secondsRemaining)} remaining`
                    : status === "pending"
                      ? `starts in ~${formatDuration(summary.secondsRemaining)}`
                      : "closed"}
                </div>
              </Detail>
              <Detail label="Tick spacing">
                <span className="tabular-nums">{info.tickSpacing.toString()}</span>
              </Detail>
            </dl>
          </section>
        </div>

        <aside className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            Embeddable widget
          </h2>
          <p className="text-xs text-neutral-500">
            This is the same <code className="text-neutral-400">@beacon/cca-widget</code> component
            any project can drop into their own site.
          </p>
          <WidgetPreview
            auction={entry.auction}
            chainId={Number(process.env.NEXT_PUBLIC_BEACON_CHAIN_ID ?? 11155111)}
          />
        </aside>
      </div>
    </main>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm text-neutral-100">{children}</dd>
    </div>
  );
}

function ExplorerLink({ address, label }: { address: string; label: string }) {
  return (
    <a
      href={explorerUrl(`/address/${address}`)}
      target="_blank"
      rel="noreferrer"
      className="hover:underline"
    >
      {label}
    </a>
  );
}
