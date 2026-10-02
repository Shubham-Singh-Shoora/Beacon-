export default function Loading() {
  return (
    <main
      id="main-content"
      className="page-width loading-page"
      aria-busy="true"
      aria-label="Loading Beacon"
    >
      <span className="sr-only" role="status">
        Loading auction data…
      </span>
      <div aria-hidden="true">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-panel" />
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="skeleton skeleton-row" />
        ))}
      </div>
    </main>
  );
}
