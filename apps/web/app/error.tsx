"use client";
import Link from "next/link";
import { Icon } from "@/components/Icons";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="error-page">
      <div className="empty-state">
        <span className="empty-icon">
          <Icon name="globe" width="30" height="30" />
        </span>
        <h3>A pause in the signal.</h3>
        <p>
          We couldn’t load this auction data. The network may be temporarily unavailable. Give it
          another moment and try again.
        </p>
        <div className="retry-actions">
          <button className="button button-primary" onClick={reset}>
            Try again <Icon name="arrow" />
          </button>
          <Link href="/" className="button button-outline">
            Back to explore
          </Link>
        </div>
      </div>
    </main>
  );
}
