import Link from "next/link";
import { formatQ96Compact, formatTokenAmount } from "@beacon/cca-sdk";
import type { AuctionStatus } from "@beacon/cca-sdk";
import { getDirectory, getListStates } from "@/lib/beacon";
import { ClearedIndicator, GraduationBadge, StatusBadge } from "@/components/Badges";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type Filter = AuctionStatus | "all" | "graduated";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "pending", label: "Upcoming" },
  { key: "ended", label: "Ended" },
  { key: "graduated", label: "Graduated" },
];

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string; q?: string }>;
}) {
  const params = await searchParams;
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? "all") as Filter;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const query = (params.q ?? "").trim().toLowerCase();

  const directory = await getDirectory();

  if (directory.empty) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Beacon</h1>
        <div className="mt-8 rounded-lg border border-neutral-800 bg-neutral-900/50 p-6">
          <p className="font-medium">No auctions indexed yet.</p>
          <p className="mt-2 text-sm text-neutral-400">
            Run <code className="rounded bg-neutral-800 px-1.5 py-0.5">pnpm sync:auctions</code> to
            scan the factory&apos;s <code>AuctionCreated</code> events and build the local store.
          </p>
        </div>
      </main>
    );
  }

  // Text search across token symbol, auction address and token address.
  const searched = query
    ? directory.entries.filter(
        (e) =>
          e.token.symbol.toLowerCase().includes(query) ||
          e.auction.toLowerCase().includes(query) ||
          e.info.token.toLowerCase().includes(query),
      )
    : directory.entries;

  // Graduation is live state, so that filter needs the states first. Fetch the
  // cheap multicall state for the filtered set before paginating on it.
  const needsGraduation = filter === "graduated";
  const preStates = needsGraduation
    ? await getListStates(searched.slice(0, 150).map((e) => e.auction))
    : new Map();

  const filtered = searched.filter((entry) => {
    if (filter === "all") return true;
    if (filter === "graduated") return preStates.get(entry.auction)?.isGraduated === true;
    return entry.status === filter;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const states = needsGraduation ? preStates : await getListStates(rows.map((e) => e.auction));
  const graduatedOnPage = rows.filter((r) => states.get(r.auction)?.isGraduated).length;

  const buildHref = (next: Partial<{ filter: Filter; page: number; q: string }>) => {
    const sp = new URLSearchParams();
    const f = next.filter ?? filter;
    if (f !== "all") sp.set("filter", f);
    const p = next.page ?? 1;
    if (p > 1) sp.set("page", String(p));
    const q = next.q ?? params.q ?? "";
    if (q) sp.set("q", q);
    const s = sp.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Beacon</h1>
        <p className="mt-2 text-neutral-400">
          Every Uniswap Continuous Clearing Auction ever deployed on{" "}
          <span className="text-neutral-300">Sepolia</span> — live and historical.
        </p>
      </header>

      {/* Ended is the normal state here, so say so plainly rather than showing
          an empty "live auctions" screen that reads like something is broken. */}
      {directory.counts.live === 0 ? (
        <div className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm">
          <span className="text-neutral-300">No auctions are open right now.</span>{" "}
          <span className="text-neutral-500">
            {directory.counts.ended} {directory.counts.ended === 1 ? "has" : "have"} closed and{" "}
            {directory.counts.pending} {directory.counts.pending === 1 ? "is" : "are"} scheduled.
            Beacon is a historical record as much as a live one — closed auctions keep their final
            clearing price and outcome.
          </span>
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Auctions" value={directory.counts.all} />
        <Stat label="Live" value={directory.counts.live} />
        <Stat label="Upcoming" value={directory.counts.pending} />
        <Stat label="Ended" value={directory.counts.ended} />
      </div>

      <nav className="mt-8 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={buildHref({ filter: f.key, page: 1 })}
            className={`rounded-full px-3 py-1.5 text-sm ring-1 ring-inset transition ${
              filter === f.key
                ? "bg-neutral-100 text-neutral-900 ring-neutral-100"
                : "bg-neutral-900 text-neutral-300 ring-neutral-800 hover:bg-neutral-800"
            }`}
          >
            {f.label}
            {f.key !== "graduated" ? (
              <span className="ml-1.5 text-xs opacity-60">
                {f.key === "all" ? directory.counts.all : directory.counts[f.key]}
              </span>
            ) : null}
          </Link>
        ))}

        <form className="ml-auto" action="/">
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search token or address"
            className="w-56 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
        </form>
      </nav>

      <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-neutral-900/60 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Token</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Clearing price</th>
              <th className="px-4 py-3 font-medium">Raised</th>
              <th className="px-4 py-3 font-medium">Cleared</th>
              <th className="px-4 py-3 font-medium">Auction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/70">
            {rows.map((entry) => {
              const state = states.get(entry.auction);
              const hasCleared = (state?.totalCleared ?? 0n) > 0n;
              return (
                <tr key={entry.auction} className="hover:bg-neutral-900/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/auction/${entry.auction}`}
                      className="font-medium text-neutral-100 hover:underline"
                    >
                      {entry.token.symbol}
                    </Link>
                    <div className="text-xs text-neutral-500">
                      {formatTokenAmount(entry.info.totalSupply, entry.token)} offered
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={entry.status} />
                      <GraduationBadge
                        isGraduated={state?.isGraduated ?? false}
                        status={entry.status}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {state ? (
                      <>
                        <span className="tabular-nums">
                          {formatQ96Compact(state.clearingPriceQ96)}
                        </span>{" "}
                        <span className="text-xs text-neutral-500">{entry.currency.symbol}</span>
                      </>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {state ? (
                      formatTokenAmount(state.currencyRaised, entry.currency)
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {state ? (
                      hasCleared ? (
                        <span className="tabular-nums">
                          {formatTokenAmount(state.totalCleared, entry.token)}
                        </span>
                      ) : (
                        <ClearedIndicator hasCleared={false} />
                      )
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    {shortAddress(entry.auction)}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-neutral-500">
                  No auctions match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
        <span>
          {filtered.length} auction{filtered.length === 1 ? "" : "s"}
          {graduatedOnPage > 0 ? ` · ${graduatedOnPage} graduated on this page` : ""}
        </span>
        <div className="flex items-center gap-3">
          {current > 1 ? (
            <Link href={buildHref({ page: current - 1 })} className="hover:text-neutral-200">
              ← Previous
            </Link>
          ) : null}
          <span>
            Page {current} of {totalPages}
          </span>
          {current < totalPages ? (
            <Link href={buildHref({ page: current + 1 })} className="hover:text-neutral-200">
              Next →
            </Link>
          ) : null}
        </div>
      </div>

      <footer className="mt-10 text-xs text-neutral-600">
        Indexed to block {directory.lastSyncedBlock.toString()} · chain head{" "}
        {directory.headBlock.toString()} · discovery via the factory&apos;s{" "}
        <code>AuctionCreated</code> event
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
