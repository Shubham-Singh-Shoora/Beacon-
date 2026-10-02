import Link from "next/link";
import { Icon } from "@/components/Icons";
export default function NotFound() {
  return (
    <main id="main-content" className="error-page">
      <div className="empty-state">
        <span className="empty-icon">
          <Icon name="search" width="30" height="30" />
        </span>
        <div className="eyebrow muted">404 / A LITTLE OFF COURSE</div>
        <h3>Let’s find your next beginning.</h3>
        <p>
          This page or auction could not be found. There’s plenty more to discover in the auction
          directory.
        </p>
        <Link href="/" className="button button-primary">
          Back to explore <Icon name="arrow" />
        </Link>
      </div>
    </main>
  );
}
