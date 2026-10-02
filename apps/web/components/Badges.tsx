import type { AuctionStatus } from "@hammerock/cca-sdk";
export function StatusBadge({ status }: { status: AuctionStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />
      {status === "live" ? "Live" : status === "pending" ? "Upcoming" : "Ended"}
    </span>
  );
}
export function GraduationBadge({
  isGraduated,
  status,
}: {
  isGraduated: boolean;
  status: AuctionStatus;
}) {
  if (isGraduated) return <span className="outcome-badge">↗ Graduated</span>;
  if (status !== "ended") return null;
  return <span className="outcome-neutral">Not graduated</span>;
}
export function ScheduleProgress({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className="schedule-progress">
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Supply schedule released"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${percent}%` }} />
      </div>
      <span>{percent.toFixed(0)}%</span>
    </div>
  );
}
export function ClearedIndicator({ hasCleared }: { hasCleared: boolean }) {
  return <span className="muted">{hasCleared ? "Cleared" : "Nothing cleared"}</span>;
}
