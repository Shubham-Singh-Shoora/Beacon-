import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./handbook.css";
import "./telegram.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: { default: "Beacon — A clearer view of every launch", template: "%s | Beacon" },
  description:
    "Discover and explore Continuous Clearing Auctions. Follow token launches, clearing prices, and onchain outcomes with Beacon.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
