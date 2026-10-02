import Link from "next/link";
import { Icon } from "@/components/Icons";
import { LearningJourney } from "@/components/LearningJourney";
export const metadata = { title: "A different kind of beginning" };
const questions = [
  [
    "What is a Continuous Clearing Auction?",
    "A Continuous Clearing Auction (CCA) releases token supply over a defined schedule. Bids contribute to price discovery as the auction progresses, rather than selling the entire supply at a single instant.",
  ],
  [
    "What does the clearing price mean?",
    "The clearing price is the price determined by the auction contract from supply and demand. Your maximum bid price sets the highest price you are willing to pay. Beacon displays the contract’s clearing price in the auction’s bid currency.",
  ],
  [
    "What does graduated mean?",
    "Graduation means the auction has met its configured funding threshold. An auction can end without graduating; closing and graduating are different outcomes.",
  ],
  [
    "Is supply released the same as tokens sold?",
    "No. The supply schedule tracks how much supply has been made available over time. Tokens cleared shows the amount that actually sold. A completed schedule can reach 100% even when no tokens have cleared.",
  ],
  [
    "Why are there so many ended auctions?",
    "Beacon is a historical record as well as a discovery tool. Ended auctions stay visible so you can explore their final clearing prices and outcomes. Use the Live or Upcoming filters to find auctions that are still open or scheduled.",
  ],
  [
    "Which network am I exploring?",
    "Beacon tracks Ethereum, Base, Unichain and Arbitrum, plus Sepolia, a test network. Pick a network above the auction list; every auction page names its network. Mainnet auctions involve real funds, Sepolia auctions are test activity. You can view each auction’s contract on the linked block explorer.",
  ],
];
export default function LearnPage() {
  return (
    <main id="main-content" className="page-width editorial-page">
      <header className="editorial-hero reveal">
        <div className="eyebrow">
          <span className="pink-dot" /> OPEN FROM THE BEGINNING
        </div>
        <h1>
          New tokens.
          <br />
          <span>A different kind of start.</span>
        </h1>
        <p>
          Follow a trail from your first auction to your own discovery. Explore the concepts, try
          the experiments, and collect a little clarity at every stop.
        </p>
      </header>
      <LearningJourney />
      <section className="field-glossary" aria-labelledby="glossary-heading">
        <div className="journey-heading">
          <div>
            <span className="eyebrow">KEEP THESE IN YOUR FIELD NOTES</span>
            <h2 id="glossary-heading">A pocket guide to the language.</h2>
            <p>The terms you will meet in an auction, translated.</p>
          </div>
          <Icon name="code" width="30" height="30" />
        </div>
        <dl className="glossary-grid">
          {[
            [
              "Clearing price",
              "The contract-determined price, denominated in bid currency per token. This is different from a bidder’s maximum price.",
            ],
            [
              "Bid currency",
              "The asset used to participate, such as native ETH or an ERC-20 token. Check it before interpreting amounts.",
            ],
            [
              "Floor price",
              "The lowest configured auction price. A bid cap must also respect the contract’s permitted price boundaries.",
            ],
            [
              "Tick spacing",
              "The interval between valid bid prices. Beacon’s SDK aligns a price cap down so it never raises the limit you entered.",
            ],
            [
              "Q96",
              "The fixed-point format the contract uses for prices: a value scaled by 2⁹⁶. SDK formatters turn it into a readable decimal.",
            ],
            [
              "Checkpoint",
              "A record of auction progress. A stored checkpoint can lag; the detail view’s state lens calculates a fresh one for its read.",
            ],
          ].map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="faq-section">
        <h2>A little more clarity.</h2>
        {questions.map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <Icon name="chevron" width="18" height="18" />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>
      <div className="center-actions">
        <Link href="/#auctions" className="button button-primary">
          Explore auctions <Icon name="arrow" />
        </Link>
        <Link href="/developers" className="button button-outline">
          Build with Beacon <Icon name="code" />
        </Link>
      </div>
    </main>
  );
}
