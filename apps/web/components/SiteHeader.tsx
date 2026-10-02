"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BeaconMark, EthereumMark, Icon } from "./Icons";
const links = [
  { href: "/", label: "Explore" },
  { href: "/learn", label: "Learn" },
  { href: "/developers", label: "Build" },
];
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="wordmark" aria-label="Beacon home" onClick={() => setOpen(false)}>
          <BeaconMark />
          <span>beacon</span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={
                pathname === href || (href === "/" && pathname.startsWith("/auction"))
                  ? "active"
                  : ""
              }
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <span className="network-pill" title="Ethereum, Base, Unichain and Arbitrum, plus the Sepolia test network">
            <EthereumMark />
            <span>Multichain</span>
            <span className="network-dot" />
          </span>
          <Link className="button button-soft header-cta" href="/#auctions">
            Explore auctions <Icon name="external" />
          </Link>
          <button
            className="icon-button mobile-menu-button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-navigation" className="mobile-nav" aria-label="Mobile navigation">
          {links.map(({ href, label }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {label}
              <Icon name="arrow" />
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
