import Link from "next/link";
import { formatQ96Compact, formatTokenAmount } from "@hammerock/cca-sdk";
import type { AuctionListState, AuctionStatus, Address } from "@hammerock/cca-sdk";
import { getDirectory, getListStates, getNetworkCounts, resolveNetwork } from "@/lib/beacon";
import { GraduationBadge, StatusBadge } from "@/components/Badges";
import { BeaconVisual } from "@/components/BeaconVisual";
import { DirectoryControls } from "@/components/DirectoryControls";
import { Icon } from "@/components/Icons";
import { TokenAvatar } from "@/components/TokenAvatar";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;
type Filter = AuctionStatus | "all" | "graduated";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All auctions" },
  { key: "live", label: "Live" },
  { key: "pending", label: "Upcoming" },
  { key: "ended", label: "Ended" },
  { key: "graduated", label: "Graduated" },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    chain?: string;
    filter?: string;
    page?: string;
    q?: string;
    sort?: string;
    view?: string;
  }>;
}) {
  const params = await searchParams;
  const filter = FILTERS.find((f) => f.key === params.filter)?.key ?? "all";
  const page = Math.max(1, Math.floor(Number(params.page) || 1));
  const query = (params.q ?? "").trim().toLowerCase();
  const sort = params.sort === "oldest" ? "oldest" : "newest";
  const view = params.view === "grid" ? "grid" : "list";
  const network = resolveNetwork(params.chain);
  const [directory, networkCounts] = await Promise.all([getDirectory(network), getNetworkCounts()]);
  const searched = directory.entries.filter(
    (e) =>
      !query ||
      [e.token.symbol, e.token.name, e.auction, e.info.token].some((value) =>
        value.toLowerCase().includes(query),
      ),
  );
  if (sort === "oldest") searched.reverse();
  const preStates: Map<Address, AuctionListState> =
    filter === "graduated"
      ? await getListStates(
          network,
          directory.entries.map((e) => e.auction),
        )
      : new Map();
  const graduationUnavailable =
    filter === "graduated" && searched.some((entry) => !preStates.has(entry.auction));
  const filtered = searched.filter(
    (entry) =>
      filter === "all" ||
      (filter === "graduated"
        ? preStates.get(entry.auction)?.isGraduated === true
        : entry.status === filter),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const states =
    filter === "graduated"
      ? preStates
      : await getListStates(
          network,
          rows.map((e) => e.auction),
        );
  const href = (next: { filter?: Filter; page?: number }) => {
    const sp = new URLSearchParams();
    sp.set("chain", network.slug);
    const f = next.filter ?? filter;
    if (f !== "all") sp.set("filter", f);
    if ((next.page ?? 1) > 1) sp.set("page", String(next.page));
    if (params.q) sp.set("q", params.q);
    if (sort !== "newest") sp.set("sort", sort);
    if (view !== "list") sp.set("view", view);
    return `/${sp.size ? `?${sp}` : ""}#auctions`;
  };

  return (
    <main id="main-content">
      <section className="hero page-width">
        <div className="hero-copy reveal">
          <div className="eyebrow">
            <span className="pink-dot" /> THE ONCHAIN AUCTION EXPLORER
          </div>
          <h1>
            A new wave of
            <br />
            <span>token discovery.</span>
          </h1>
          <p>
            Great things start in the open. Discover token auctions,
            <br className="desktop-break" /> follow every launch, and see what comes next.
          </p>
          <div className="hero-actions">
            <Link href="#auctions" className="button button-primary">
              Explore auctions <Icon name="arrow" />
            </Link>
            <Link href="/learn" className="text-link">
              How it works <Icon name="external" width="18" height="18" />
            </Link>
          </div>
          <div className="hero-note">
            <Icon name="globe" width="14" height="14" /> Permissionless. Transparent. Onchain.
          </div>
        </div>
        <BeaconVisual />
      </section>
      <div className="page-width">
        <section className="stats-strip reveal" aria-label="Auction overview">
          <Stat
            label="Auctions discovered"
            value={directory.counts.all}
            icon="layers"
            detail="Every launch, one place"
          />
          <Stat
            label={directory.isStale ? "Live at last index" : "Live now"}
            value={directory.counts.live}
            icon="sparkles"
            detail={
              directory.isStale
                ? "Awaiting network updates"
                : directory.counts.live
                  ? "Price discovery in motion"
                  : "Between new beginnings"
            }
            live
          />
          <Stat
            label={directory.isStale ? "Scheduled at last index" : "Coming up"}
            value={directory.counts.pending}
            icon="clock"
            detail="The next wave of launches"
          />
          <Stat
            label="Auctions completed"
            value={directory.counts.ended}
            icon="check"
            detail="A permanent onchain record"
          />
        </section>
        <section id="auctions" className="auction-section">
          <div className="section-heading">
            <div>
              <div className="eyebrow muted">A WORLD OF POSSIBILITY</div>
              <h2>
                Find your next beginning<span className="pink-text">.</span>
              </h2>
            </div>
            <span className="data-label">
              <span className={directory.isStale ? "status-dot" : "network-dot"} />{" "}
              {directory.isStale ? "Cached network snapshot" : "Onchain data"}
              <span className="label-divider" /> {network.name}
              {network.testnet ? " testnet" : ""}
            </span>
          </div>
          <nav className="filter-tabs chain-tabs" aria-label="Choose network">
            {networkCounts.map(({ network: n, all, live }) => (
              <a
                key={n.slug}
                href={`/?chain=${n.slug}#auctions`}
                className={n.slug === network.slug ? "active" : ""}
                aria-current={n.slug === network.slug ? "page" : undefined}
                title={n.testnet ? `${n.name} (test network)` : n.name}
              >
                {live > 0 && <span className="network-dot" />}
                {n.name}
                {n.testnet && <span className="muted"> · test</span>}
                <span className="filter-count">{all}</span>
              </a>
            ))}
          </nav>
          <div className="directory-toolbar">
            <nav className="filter-tabs" aria-label="Filter auctions">
              {FILTERS.map((f) => (
                <a
                  key={f.key}
                  href={href({ filter: f.key })}
                  className={filter === f.key ? "active" : ""}
                  aria-current={filter === f.key ? "page" : undefined}
                >
                  {f.key === "live" && <span className="network-dot" />}
                  {f.label}
                  {f.key === "all" && <span className="filter-count">{directory.counts.all}</span>}
                </a>
              ))}
            </nav>
            <DirectoryControls
              chain={network.slug}
              query={params.q ?? ""}
              filter={filter}
              sort={sort}
              view={view}
            />
          </div>
          {directory.isStale && (
            <div className="notice">
              <Icon name="clock" />
              <p>
                Network updates are temporarily unavailable. Statuses reflect the last indexed
                block; live prices may be unavailable.
              </p>
            </div>
          )}
          {graduationUnavailable && (
            <div className="notice">
              <Icon name="clock" />
              <p>
                Some auction outcomes could not be loaded. Only verified graduated auctions are
                shown.
              </p>
            </div>
          )}
          {directory.indexLagging && (
            <div className="notice">
              <Icon name="clock" />
              <p>
                The discovery index is catching up. Recently created auctions may be missing;
                existing auction states are read from the network.
              </p>
            </div>
          )}
          {!directory.isStale && directory.counts.live === 0 && filter === "all" && (
            <div className="directory-note">
              <span className="quiet-dot" /> A little quiet, a lot to discover. Explore completed
              auctions while the next launches take shape.
              <Link href="/learn">
                Meet continuous auctions <Icon name="arrow" width="14" height="14" />
              </Link>
            </div>
          )}
          {rows.length > 0 ? (
            <div className={`auction-results ${view === "grid" ? "results-grid" : "results-list"}`}>
              <div className="table-heading">
                <span>Token / Auction</span>
                <span>Status</span>
                <span>Clearing price</span>
                <span>Total raised</span>
                <span>Tokens cleared</span>
                <span />
              </div>
              {rows.map((entry) => {
                const state = states.get(entry.auction);
                return (
                  <article className="auction-row" key={entry.auction}>
                    <div className="token-cell">
                      <TokenAvatar symbol={entry.token.symbol} address={entry.info.token} />
                      <div>
                        <Link
                          href={`/auction/${entry.auction}?chain=${network.slug}`}
                          className="token-name"
                        >
                          {entry.token.symbol}
                          <Icon name="external" width="14" height="14" />
                        </Link>
                        <span className="token-subtitle" title={entry.token.name}>
                          {entry.token.name}
                        </span>
                        <span className="token-address">
                          {entry.auction.slice(0, 6)}…{entry.auction.slice(-4)}
                        </span>
                      </div>
                    </div>
                    <div className="status-cell">
                      <StatusBadge status={entry.status} />
                      {state && (
                        <GraduationBadge isGraduated={state.isGraduated} status={entry.status} />
                      )}
                    </div>
                    <div className="metric-cell">
                      <span className="mobile-metric-label">Clearing price</span>
                      <strong>{state ? formatQ96Compact(state.clearingPriceQ96) : "—"}</strong>
                      <span>
                        {state
                          ? `${entry.currency.symbol} per ${entry.token.symbol}`
                          : "Unavailable"}
                      </span>
                    </div>
                    <div className="metric-cell">
                      <span className="mobile-metric-label">Total raised</span>
                      <strong>
                        {state ? formatTokenAmount(state.currencyRaised, entry.currency) : "—"}
                      </strong>
                      <span>{formatTokenAmount(entry.info.totalSupply, entry.token)} offered</span>
                    </div>
                    <div className="metric-cell cleared-cell">
                      <span className="mobile-metric-label">Tokens cleared</span>
                      <strong>
                        {state ? formatTokenAmount(state.totalCleared, entry.token) : "—"}
                      </strong>
                      <span>
                        {state
                          ? state.totalCleared > 0n
                            ? "Supply distributed"
                            : "No supply distributed"
                          : "Unavailable"}
                      </span>
                    </div>
                    <Link
                      href={`/auction/${entry.auction}?chain=${network.slug}`}
                      className="row-arrow"
                      aria-label={`View ${entry.token.symbol} auction ${entry.auction.slice(-4)}`}
                    >
                      <Icon name="arrow" width="18" height="18" />
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                <Icon name={query ? "search" : "sparkles"} width="30" height="30" />
              </span>
              <h3>
                {directory.empty
                  ? "Every beginning starts somewhere."
                  : query
                    ? "No discoveries just yet."
                    : filter === "live"
                      ? "The next wave is on its way."
                      : "Nothing here just yet."}
              </h3>
              <p>
                {directory.empty
                  ? "New auctions will appear here as they are indexed. Check back soon."
                  : query
                    ? "Try another token name, symbol, or contract address."
                    : filter === "live"
                      ? "There are no live auctions right now. Explore the stories of past launches."
                      : "Explore all auctions to see more token launches."}
              </p>
              <Link href={`/?chain=${network.slug}#auctions`} className="button button-soft">
                {directory.empty ? "Refresh directory" : "Explore all auctions"}
                <Icon name="arrow" />
              </Link>
            </div>
          )}
          <div className="pagination">
            <span>
              {filtered.length
                ? `${(current - 1) * PAGE_SIZE + 1}–${Math.min(current * PAGE_SIZE, filtered.length)} of ${filtered.length} auctions`
                : "0 auctions"}
            </span>
            <div>
              {current > 1 ? (
                <a
                  href={href({ page: current - 1 })}
                  className="icon-button"
                  aria-label="Previous page"
                >
                  <Icon name="arrow" className="arrow-back" width="16" height="16" />
                </a>
              ) : (
                <span className="icon-button disabled" aria-hidden="true">
                  <Icon name="arrow" className="arrow-back" width="16" height="16" />
                </span>
              )}
              <span>
                Page <strong>{current}</strong> of {totalPages}
              </span>
              {current < totalPages ? (
                <a
                  href={href({ page: current + 1 })}
                  className="icon-button"
                  aria-label="Next page"
                >
                  <Icon name="arrow" width="16" height="16" />
                </a>
              ) : (
                <span className="icon-button disabled" aria-hidden="true">
                  <Icon name="arrow" width="16" height="16" />
                </span>
              )}
            </div>
          </div>
          <div className="index-note">
            <span className="network-dot" /> Indexed through block{" "}
            {directory.lastSyncedBlock.toLocaleString("en-US")}
            <span>·</span>
            {directory.isStale
              ? "Awaiting network connection"
              : `Network block ${directory.headBlock.toLocaleString("en-US")}`}
          </div>
        </section>
        <Link href="/telegram" className="telegram-invitation">
          <span className="telegram-invitation-icon">
            <Icon name="sparkles" />
          </span>
          <span>
            <strong>Your next signal, in Telegram.</strong>
            <span>Follow an auction. Keep up with the moments that matter.</span>
          </span>
          <span className="telegram-invitation-link">
            Explore alerts <Icon name="arrow" />
          </span>
        </Link>
        <section className="discovery-banner">
          <div className="banner-art" aria-hidden="true">
            <div />
            <div />
            <div />
            <span>✳</span>
          </div>
          <div>
            <span className="eyebrow">FAIRER STARTS. OPEN POSSIBILITIES.</span>
            <h2>
              Good ideas deserve
              <br />a great beginning.
            </h2>
            <p>
              Get to know a different way to launch.
              <br />
              Continuous auctions. Transparent price discovery.
            </p>
            <Link href="/learn" className="text-link">
              Discover how it works <Icon name="arrow" />
            </Link>
          </div>
          <Link href="/developers" className="builder-callout">
            <span className="builder-icon">
              <Icon name="code" />
            </span>
            <h3>Made for builders.</h3>
            <p>
              Bring auction data to your world
              <br />
              with the Beacon SDK and widget.
            </p>
            <span>
              Start building <Icon name="external" width="17" height="17" />
            </span>
          </Link>
        </section>
      </div>
    </main>
  );
}
function Stat({
  label,
  value,
  icon,
  detail,
  live = false,
}: {
  label: string;
  value: number;
  icon: React.ComponentProps<typeof Icon>["name"];
  detail: string;
  live?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        <Icon name={icon} width="16" height="16" />
      </div>
      <div className="stat-value">
        {value.toLocaleString("en-US")}
        {live && <span className={value > 0 ? "live-indicator" : "inactive-indicator"} />}
      </div>
      <p>{detail}</p>
    </div>
  );
}
