import { BuildGuide } from "@/components/BuildGuide";
import { Icon } from "@/components/Icons";

export const metadata = {
  title: "Build with Beacon",
  description:
    "Guided setup for the Beacon SDK, React widget, Telegram auction bot, and bidding agent. Start with the first command and connect to real auction data.",
};

export default async function DevelopersPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  return (
    <main id="main-content" className="page-width editorial-page">
      <header className="editorial-hero reveal">
        <div className="eyebrow">
          <Icon name="code" width="16" height="16" /> THE NEXT THING IS YOURS TO BUILD
        </div>
        <h1>
          Your ideas.
          <br />
          <span>Powered by Beacon.</span>
        </h1>
        <p>
          From your first contract read to a tool of your own. Pick a path, follow the setup, and
          bring continuous auctions into your world.
        </p>
        <a href="#choose-tool" className="handbook-hero-link">
          Find your starting point <Icon name="arrow" width="16" height="16" />
        </a>
      </header>
      <BuildGuide initialTool={tool} />
    </main>
  );
}
