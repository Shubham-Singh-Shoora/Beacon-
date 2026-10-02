import Link from "next/link";
import { notFound } from "next/navigation";
import { isAddress } from "viem";
import type { Address } from "viem";
import { formatQ96, formatQ96Compact, formatTokenAmount } from "@hammerock/cca-sdk";
import {
  defaultNetwork,
  explorerUrl,
  findAuctionNetwork,
  getAuctionDetail,
  resolveNetwork,
} from "@/lib/beacon";
import { GraduationBadge, StatusBadge } from "@/components/Badges";
import { LiveState } from "@/components/LiveState";
import { WidgetPreview } from "@/components/WidgetPreview";
import { TokenAvatar } from "@/components/TokenAvatar";
import { CopyButton } from "@/components/CopyButton";
import { Icon } from "@/components/Icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Auction explorer" };
function formatDuration(seconds: number) {
  if (seconds <= 0) return "less than a minute";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
export default async function AuctionPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ chain?: string }>;
}) {
  const { address } = await params;
  const { chain } = await searchParams;
  if (!isAddress(address)) notFound();
  // ?chain= when the link carries it; otherwise whichever chain's store holds
  // this auction, so links from before multi-chain keep working.
  const network = chain
    ? resolveNetwork(chain)
    : ((await findAuctionNetwork(address as Address)) ?? defaultNetwork());
  const detail = await getAuctionDetail(network, address as Address);
  if (!detail) notFound();
  const { entry, summary } = detail;
  const explorer = (path: string) => explorerUrl(network, path);
  const back = `/?chain=${network.slug}#auctions`;
  const { info, token, currency, status } = entry;
  const ended = status === "ended";
  return (
    <main id="main-content" className="page-width detail-page">
      <Link href={back} className="breadcrumb">
        <Icon name="arrow" className="arrow-back" width="16" height="16" /> Back to all auctions
      </Link>
      <header className="detail-header">
        <div className="detail-title">
          <TokenAvatar symbol={token.symbol} address={info.token} large />
          <div>
            <div className="detail-heading-line">
              <h1>{token.symbol}</h1>
              <div className="detail-badges">
                <StatusBadge status={status} />
                {summary && (
                  <GraduationBadge isGraduated={summary.state.isGraduated} status={status} />
                )}
              </div>
            </div>
            <p>
              {token.name} <span className="muted">· Continuous Clearing Auction</span>
            </p>
          </div>
        </div>
        <div className="address-actions">
          <a
            className="address-link"
            href={explorer(`/address/${entry.auction}`)}
            target="_blank"
            rel="noreferrer"
            title={entry.auction}
          >
            {entry.auction.slice(0, 8)}…{entry.auction.slice(-6)}
            <Icon name="external" width="14" height="14" />
          </a>
          <CopyButton text={entry.auction} label="Copy address" />
        </div>
      </header>
      <div className="detail-grid">
        <div className="detail-main">
          {summary ? (
            <LiveState
              auction={entry.auction}
              chainSlug={network.slug}
              networkName={network.name}
              token={token}
              currency={currency}
              isEnded={ended}
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
          ) : (
            <section className="panel price-panel">
              <div className="panel-heading">
                <h2>Auction overview</h2>
                <span>Network unavailable</span>
              </div>
              <div className="price-label">Current clearing price</div>
              <div className="main-price">—</div>
              <p className="price-unit">Live data is temporarily unavailable.</p>
              <div className="price-divider" />
              <p className="notice">
                Showing the indexed auction configuration. Status reflects the last indexed block.
                Refresh to try the network again.
              </p>
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>The auction, in detail</h2>
              <span>Onchain configuration</span>
            </div>
            <dl className="config-grid">
              <Detail label="Token contract">
                <ExplorerLink href={explorer(`/address/${info.token}`)} label={`${token.symbol} ↗`} />
                <small>{token.decimals} decimals</small>
              </Detail>
              <Detail label="Bid currency">
                {currency.isNative ? (
                  `${currency.symbol} (native)`
                ) : (
                  <ExplorerLink href={explorer(`/address/${info.currency}`)} label={`${currency.symbol} ↗`} />
                )}
              </Detail>
              <Detail label="Supply offered">{formatTokenAmount(info.totalSupply, token)}</Detail>
              <Detail label="Floor price">
                <span title={formatQ96(info.floorPriceQ96)}>
                  {formatQ96Compact(info.floorPriceQ96)} {currency.symbol}
                </span>
              </Detail>
              <Detail label="Auction window">
                {info.startBlock.toLocaleString("en-US")} → {info.endBlock.toLocaleString("en-US")}
                <small>
                  {!summary
                    ? "Status at last indexed block"
                    : ended
                      ? "Auction has closed"
                      : status === "live"
                        ? `Approximately ${formatDuration(summary.secondsRemaining)} remaining`
                        : `Starts in approximately ${formatDuration(summary.secondsRemaining)}`}
                </small>
              </Detail>
              <Detail label="Tick spacing">{info.tickSpacing.toString()}</Detail>
            </dl>
          </section>
        </div>
        <aside className="detail-aside">
          <section className="bid-panel">
            {!summary ? (
              <>
                <div className="auction-closed-visual" aria-hidden="true">
                  <span>
                    <Icon name="clock" width="31" height="31" />
                  </span>
                </div>
                <h2>Waiting for the signal.</h2>
                <p>
                  Connect to the network to see the latest auction outcome and bidding availability.
                </p>
                <a href={`/auction/${entry.auction}?chain=${network.slug}`} className="button button-soft">
                  Refresh auction <Icon name="arrow" />
                </a>
              </>
            ) : ended ? (
              <>
                <div className="auction-closed-visual" aria-hidden="true">
                  <span>
                    <Icon name="check" width="31" height="31" />
                  </span>
                </div>
                <h2>A chapter, complete.</h2>
                <p>
                  This auction has ended. Its clearing price and outcome remain here as part of the
                  onchain record.
                </p>
                <Link href={back} className="button button-soft">
                  Discover more auctions <Icon name="arrow" width="17" height="17" />
                </Link>
              </>
            ) : (
              <>
                <h2>
                  {status === "pending" ? "A new beginning, soon." : "Be part of the beginning."}
                </h2>
                <p>
                  {status === "pending"
                    ? "Bidding opens when the auction reaches its start block."
                    : "Set your maximum price and bid amount to participate in this auction."}
                </p>
                <WidgetPreview
                  auction={entry.auction}
                  chainId={network.chainId}
                  rpcUrl={network.rpcUrl}
                />
              </>
            )}
          </section>
          <div className="aside-note">
            <Icon name="globe" width="18" height="18" />
            <p>
              {network.testnet
                ? `This auction is on ${network.name}, a test network.`
                : `This auction is on ${network.name}. Bids use real funds from your wallet, which shows and signs every transaction.`}
              <br />
              <Link href="/learn">Learn about continuous auctions ↗</Link>
            </p>
          </div>
        </aside>
      </div>
      <p className="detail-bottom-note">
        <Icon name="layers" width="14" height="14" /> Read directly from the auction contract.{" "}
        {!summary
          ? "Configuration is from the indexed record; current state could not be verified."
          : ended
            ? "Closed auctions preserve their final outcome."
            : "Auction state refreshes automatically every 12 seconds."}
      </p>
    </main>
  );
}
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
