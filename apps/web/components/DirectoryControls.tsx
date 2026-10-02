"use client";
import { useState } from "react";
import { Icon } from "./Icons";
export function DirectoryControls({
  chain,
  query,
  filter,
  sort,
  view,
}: {
  chain: string;
  query: string;
  filter: string;
  sort: string;
  view: string;
}) {
  const [pending, setPending] = useState(false);
  function navigate(next: { q?: string; sort?: string; view?: string }) {
    const params = new URLSearchParams();
    params.set("chain", chain);
    if (filter !== "all") params.set("filter", filter);
    const values = { q: query, sort, view, ...next };
    if (values.q.trim()) params.set("q", values.q.trim());
    if (values.sort !== "newest") params.set("sort", values.sort);
    if (values.view !== "list") params.set("view", values.view);
    setPending(true);
    window.location.assign(`/?${params.toString()}#auctions`);
  }
  return (
    <div className={`directory-controls${pending ? " is-pending" : ""}`} aria-busy={pending}>
      <form
        className="search-field"
        action="/#auctions"
        method="get"
        onSubmit={() => setPending(true)}
      >
        <input type="hidden" name="chain" value={chain} />
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
        {view !== "list" && <input type="hidden" name="view" value={view} />}
        <button type="submit" aria-label="Search auctions">
          <Icon name="search" width="18" height="18" />
        </button>
        <input
          key={query}
          name="q"
          aria-label="Search by token name, symbol, or address"
          defaultValue={query}
          placeholder="Search tokens or addresses"
          autoComplete="off"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => navigate({ q: "" })}>
            <Icon name="close" width="16" height="16" />
          </button>
        )}
      </form>
      <label className="sort-control">
        <span className="sr-only">Sort auctions</span>
        <select value={sort} onChange={(event) => navigate({ sort: event.target.value })}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <Icon name="chevron" width="16" height="16" />
      </label>
      <div className="view-controls" aria-label="Auction layout">
        <button
          type="button"
          className={view === "list" ? "selected" : ""}
          aria-label="List view"
          aria-pressed={view === "list"}
          onClick={() => navigate({ view: "list" })}
        >
          <Icon name="list" width="18" height="18" />
        </button>
        <button
          type="button"
          className={view === "grid" ? "selected" : ""}
          aria-label="Grid view"
          aria-pressed={view === "grid"}
          onClick={() => navigate({ view: "grid" })}
        >
          <Icon name="grid" width="17" height="17" />
        </button>
      </div>
      <span className="sr-only" role="status">
        {pending ? "Updating auctions" : ""}
      </span>
    </div>
  );
}
