import type { AuctionStatus } from "@beacon/cca-sdk";

/**
 * Status badges.
 *
 * Design note: on this network "ended" is the NORMAL state - 132 of 133
 * auctions have closed. So "Ended" is styled as neutral information, not as a
 * failure or a warning. The meaningful success signal for a closed auction is
 * whether it GRADUATED, which gets its own badge.
 */

const STATUS_STYLES: Record<AuctionStatus, { label: string; className: string }> = {
  live: {
    label: "Live",
    className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  },
  pending: {
    label: "Upcoming",
    className: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  },
  ended: {
    // Neutral: closed is the expected end state, not an error.
    label: "Ended",
    className: "bg-neutral-500/15 text-neutral-300 ring-neutral-500/30",
  },
};

export function StatusBadge({ status }: { status: AuctionStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {status === "live" ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
      ) : null}
      {label}
    </span>
  );
}

/**
 * Outcome badge. Only rendered for auctions that have actually finished -
 * "did not graduate" on a live auction would be misleading, since it still can.
 */
export function GraduationBadge({
  isGraduated,
  status,
}: {
  isGraduated: boolean;
  status: AuctionStatus;
}) {
  if (isGraduated) {
    return (
      <span className="inline-flex items-center rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30">
        Graduated
      </span>
    );
  }
  if (status !== "ended") return null;
  return (
    <span className="inline-flex items-center rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs font-medium text-neutral-400 ring-1 ring-inset ring-neutral-700">
      Did not graduate
    </span>
  );
}

/**
 * Supply schedule progress.
 *
 * Explicitly NOT labelled "% sold". `cumulativeMps` tracks how much of the
 * supply schedule has been released; an auction that ends having sold nothing
 * still reaches 100%. What actually sold is `totalCleared`.
 */
export function ScheduleProgress({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className="flex items-center gap-2" title="Supply schedule released - not the amount sold">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full bg-neutral-500" style={{ width: `${percent}%` }} />
      </div>
      <span className="tabular-nums text-xs text-neutral-500">{percent.toFixed(0)}% sched.</span>
    </div>
  );
}

/** Whether any supply actually cleared - the honest "did it sell" signal. */
export function ClearedIndicator({ hasCleared }: { hasCleared: boolean }) {
  return hasCleared ? (
    <span className="text-xs text-neutral-300">cleared</span>
  ) : (
    <span className="text-xs text-neutral-600">nothing cleared</span>
  );
}
