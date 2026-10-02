import Link from "next/link";
import { BeaconMark, Icon } from "./Icons";
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <Link href="/" className="wordmark">
          <BeaconMark />
          <span>beacon</span>
        </Link>
        <p>A clearer view of every launch.</p>
      </div>
      <div className="footer-links">
        <Link href="/learn">How it works</Link>
        <Link href="/developers">For developers</Link>
        <a href="https://github.com/Shubham-Singh-Shoora/Beacon-" target="_blank" rel="noreferrer">
          GitHub <Icon name="external" width="15" height="15" />
        </a>
      </div>
      <span className="footer-network">
        <span className="network-dot" /> Built for the open internet
      </span>
    </footer>
  );
}
