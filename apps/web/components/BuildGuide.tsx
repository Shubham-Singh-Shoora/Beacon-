"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icons";
import type { IconName } from "./Icons";

const AUCTION = "0x1e40451D6ecabA8640559b7dFbe63B41dA52460d";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const REPO = "https://github.com/Shubham-Singh-Shoora/Beacon-/tree/master";
const tools: {
  id: string;
  name: string;
  type: string;
  description: string;
  icon: IconName;
  path: string;
}[] = [
  {
    id: "widget",
    name: "Embed an auction",
    type: "REACT WIDGET",
    description: "A live card inside your own app.",
    icon: "grid",
    path: "packages/widget",
  },
  {
    id: "sdk",
    name: "Build your own view",
    type: "TYPESCRIPT SDK",
    description: "Read, discover, and work with auctions.",
    icon: "code",
    path: "packages/sdk",
  },
  {
    id: "telegram",
    name: "Follow the signal",
    type: "TELEGRAM BOT",
    description: "Auction alerts, delivered to your chat.",
    icon: "globe",
    path: "apps/telegram-bot",
  },
  {
    id: "agent",
    name: "Run a bidding strategy",
    type: "BIDDING AGENT",
    description: "A CLI with explicit limits and dry runs.",
    icon: "sparkles",
    path: "apps/bidding-agent",
  },
];

export function BuildGuide({ initialTool = "widget" }: { initialTool?: string }) {
  const [selected, setSelected] = useState(
    tools.some((tool) => tool.id === initialTool) ? initialTool : "widget",
  );
  const tool = tools.find((item) => item.id === selected)!;
  return (
    <div className="build-handbook">
      <section aria-labelledby="choose-tool" className="tool-picker-section">
        <div className="journey-heading">
          <div>
            <span className="eyebrow">ONE PROTOCOL. YOUR WAY IN.</span>
            <h2 id="choose-tool">What would you like to build?</h2>
            <p>Choose a path. We’ll take it from the first command.</p>
          </div>
          <span className="handbook-label">
            THE DEVELOPER HANDBOOK <Icon name="code" width="15" height="15" />
          </span>
        </div>
        <div className="tool-picker" aria-label="Choose a developer guide">
          {tools.map((item) => (
            <button
              type="button"
              key={item.id}
              className={selected === item.id ? "selected" : ""}
              aria-pressed={selected === item.id}
              aria-controls="build-guide"
              onClick={() => setSelected(item.id)}
            >
              <span className="tool-type">
                <Icon name={item.icon} width="19" height="19" />
                {item.type}
              </span>
              <strong>{item.name}</strong>
              <span className="tool-description">{item.description}</span>
              <span className="tool-open">
                {selected === item.id ? "You’re on this path" : "Open the guide"}
                <Icon name={selected === item.id ? "check" : "arrow"} width="16" height="16" />
              </span>
            </button>
          ))}
        </div>
      </section>
      <div className="handbook-layout" id="build-guide">
        <aside className="handbook-sidebar">
          <span className="eyebrow">IN THIS GUIDE</span>
          <nav aria-label={`${tool.type} guide sections`}>
            <a href="#guide-start">
              01 <span>Before you begin</span>
            </a>
            <a href="#guide-install">
              02{" "}
              <span>{selected === "agent" ? "Initialize your setup" : "Install & configure"}</span>
            </a>
            <a href="#guide-connect">
              03{" "}
              <span>
                {selected === "telegram"
                  ? "Start & subscribe"
                  : selected === "agent"
                    ? "Inspect & simulate"
                    : "Connect your auction"}
              </span>
            </a>
            <a href="#guide-run">
              04 <span>{selected === "agent" ? "Run with limits" : "Run & verify"}</span>
            </a>
            <a href="#guide-reference">
              05 <span>Keep building</span>
            </a>
          </nav>
          <div className="sidebar-note">
            <Icon name="globe" width="19" height="19" />
            <strong>Mainnets and testnets.</strong>
            <p>Ethereum · Base · Unichain · Arbitrum</p>
            <small>
              Plus Sepolia, Base Sepolia and Unichain Sepolia. The examples use the BEACON demo
              auction on Sepolia.
            </small>
          </div>
          <a
            href={`${REPO}/${tool.path}`}
            target="_blank"
            rel="noreferrer"
            className="resource-link"
          >
            Package source <Icon name="external" width="14" height="14" />
          </a>
        </aside>
        <div className="handbook-content" key={selected}>
          {selected === "widget" ? (
            <WidgetGuide />
          ) : selected === "sdk" ? (
            <SDKGuide />
          ) : selected === "telegram" ? (
            <TelegramGuide />
          ) : (
            <AgentGuide />
          )}
        </div>
      </div>
      <section className="architecture-section">
        <div className="journey-heading">
          <div>
            <span className="eyebrow">HOW THE PIECES FIT</span>
            <h2>Four surfaces. One shared foundation.</h2>
            <p>The interfaces change. The contract-reading and bid-building logic stays shared.</p>
          </div>
        </div>
        <div className="architecture-map">
          <div className="architecture-surfaces">
            {["Directory", "React widget", "Telegram bot", "Bidding agent"].map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="architecture-branches" aria-hidden="true" />
          <div className="architecture-core">
            <Icon name="layers" />
            <div>
              <strong>@hammerock/cca-sdk</strong>
              <span>Discovery · State reads · Price formatting · Bid construction</span>
            </div>
          </div>
          <span className="architecture-stem" aria-hidden="true" />
          <div className="architecture-contracts">
            <span>CCA factory</span>
            <span>Auction contracts</span>
            <span>State lens</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function GuideCode({
  title,
  code,
  language = "Terminal",
}: {
  title: string;
  code: string;
  language?: string;
}) {
  return (
    <div className="code-panel guide-code">
      <div className="code-topbar">
        <span>
          {title}
          <small>{language}</small>
        </span>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre tabIndex={0} aria-label={`${title} code`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
function GuideStep({
  number,
  id,
  title,
  children,
}: {
  number: string;
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="guide-step">
      <div className="guide-step-heading">
        <span>{number}</span>
        <h3>{title}</h3>
      </div>
      <div className="guide-step-content">{children}</div>
    </section>
  );
}
function GuideIntro({
  label,
  title,
  text,
  requirements,
}: {
  label: string;
  title: string;
  text: string;
  requirements: string[];
}) {
  return (
    <header id="guide-start" className="guide-intro">
      <span className="eyebrow">YOUR PATH / {label}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="requirements">
        <span>YOU’LL NEED</span>
        {requirements.map((item) => (
          <span key={item}>
            <Icon name="check" width="12" height="12" />
            {item}
          </span>
        ))}
      </div>
    </header>
  );
}
function Expectation({ children }: { children: ReactNode }) {
  return (
    <div className="expected-result">
      <Icon name="check" width="17" height="17" />
      <div>
        <strong>What you should see</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}
function ReferenceTable({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="reference-table">
      {rows.map(([key, description]) => (
        <div key={key}>
          <dt>
            <code>{key}</code>
          </dt>
          <dd>{description}</dd>
        </div>
      ))}
    </dl>
  );
}
function InstallCommand({ packages, dev = false }: { packages: string; dev?: boolean }) {
  const [manager, setManager] = useState("npm");
  return (
    <>
      <div className="command-tabs" aria-label="Package manager">
        {["npm", "pnpm"].map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={manager === name}
            onClick={() => setManager(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <GuideCode
        title="Install dependencies"
        code={`${manager} ${manager === "npm" ? "install" : "add"}${dev ? " -D" : ""} ${packages}`}
      />
    </>
  );
}
function WorkspaceSetup() {
  const [shell, setShell] = useState("unix");
  return (
    <>
      <p>
        The Telegram bot runs from the Beacon repository. Clone the workspace and install from its
        root.
      </p>
      <GuideCode
        title="Get the workspace"
        code={`git clone https://github.com/Shubham-Singh-Shoora/Beacon-.git beacon\ncd beacon\npnpm install`}
      />
      <div className="command-tabs" aria-label="Terminal shell">
        <button type="button" aria-pressed={shell === "unix"} onClick={() => setShell("unix")}>
          macOS / Linux
        </button>
        <button
          type="button"
          aria-pressed={shell === "powershell"}
          onClick={() => setShell("powershell")}
        >
          PowerShell
        </button>
      </div>
      <GuideCode
        title="Create your local configuration"
        code={shell === "unix" ? "cp .env.example .env" : "Copy-Item .env.example .env"}
      />
      <p className="guide-caption">
        If you already have a .env, edit it in place. Keep configuration at the repository root and
        run the commands below from that same directory.
      </p>
    </>
  );
}

function WidgetGuide() {
  return (
    <>
      <GuideIntro
        label="REACT WIDGET"
        title="An auction, at home in your app."
        text="Add the existing auction card to a React app. This walkthrough uses a Next.js App Router project and begins with a read-only card, so a wallet is not required."
        requirements={["An existing Next.js app", "React 18+", "A public Sepolia RPC"]}
      />
      <GuideStep number="01" id="guide-install" title="Install the component">
        <p>
          Open a terminal in your app’s directory. Install the widget and its peer dependencies.
        </p>
        <InstallCommand packages="@hammerock/cca-widget viem react react-dom" />
      </GuideStep>
      <GuideStep number="02" id="guide-connect" title="Give it an auction to follow">
        <p>
          Create <code>components/Auction.tsx</code> at the project root. The example address is the
          BEACON demo auction on Sepolia; it can still be inspected after it ends.
        </p>
        <GuideCode
          title="components/Auction.tsx"
          language="TSX"
          code={`"use client";\n\nimport { AuctionCard } from "@hammerock/cca-widget";\n\nexport function Auction() {\n  return (\n    <AuctionCard\n      auction="${AUCTION}"\n      chainId={11155111}\n      rpcUrl="${RPC}"\n      readOnly\n    />\n  );\n}`}
        />
        <p className="guide-caption">
          Use the auction contract address, not its token address. The RPC URL is visible to
          visitors, so use a public endpoint without private credentials.
        </p>
      </GuideStep>
      <GuideStep number="03" id="guide-run" title="Add a page and run your app">
        <p>
          Create <code>app/auction-demo/page.tsx</code> and render the component.
        </p>
        <GuideCode
          title="app/auction-demo/page.tsx"
          language="TSX"
          code={`import { Auction } from "../../components/Auction";\n\nexport default function AuctionDemo() {\n  return <main><Auction /></main>;\n}`}
        />
        <GuideCode title="Start your Next.js development server" code="npm run dev" />
        <Expectation>
          Open <code>http://localhost:3000/auction-demo</code>. The card shows the auction’s state,
          price, and supply metrics. An ended auction shows its closed state; the example is not a
          promise of an active bidding window.
        </Expectation>
      </GuideStep>
      <GuideStep number="04" id="guide-reference" title="Make it your own">
        <ReferenceTable
          rows={[
            ["auction", "Required. The CCA auction contract address."],
            [
              "chainId",
              "Required. Mainnets: 1 (Ethereum), 8453 (Base), 130 (Unichain), 42161 (Arbitrum). Testnets: 11155111 (Sepolia), 84532 (Base Sepolia), 1301 (Unichain Sepolia).",
            ],
            ["rpcUrl", "Required. A public RPC endpoint for the selected network."],
            [
              "readOnly",
              "Hides the bid form. Remove it when you want the built-in wallet and bid flow.",
            ],
            ["pollIntervalMs", "Refresh cadence in milliseconds; defaults to 12000."],
            [
              "useAuction",
              "Use the underlying data hook when you want to design your own React interface.",
            ],
          ]}
        />
        <p>
          For bidding, visitors need a browser wallet and an open auction. The widget checks
          readiness, aligns the price to ticks, and prepares missing Permit2 approvals for ERC-20
          currencies.
        </p>
        <a
          href={`${REPO}/packages/widget#any-website`}
          target="_blank"
          rel="noreferrer"
          className="resource-link"
        >
          Using plain HTML? See the script-tag integration{" "}
          <Icon name="external" width="15" height="15" />
        </a>
      </GuideStep>
    </>
  );
}

function SDKGuide() {
  return (
    <>
      <GuideIntro
        label="TYPESCRIPT SDK"
        title="Start with one real contract read."
        text="Build your own interface or service using the same functions as the directory. This path runs a small TypeScript script that reads a Sepolia auction without a wallet."
        requirements={["Node.js 20.11+", "An empty project folder", "A Sepolia RPC"]}
      />
      <GuideStep number="01" id="guide-install" title="Create a small reading project">
        <GuideCode
          title="Initialize a project"
          code={"mkdir beacon-reader\ncd beacon-reader\nnpm init -y"}
        />
        <InstallCommand packages="@hammerock/cca-sdk viem" />
        <InstallCommand packages="tsx typescript" dev />
      </GuideStep>
      <GuideStep number="02" id="guide-connect" title="Read the auction summary">
        <p>
          Create <code>read-auction.ts</code>. The client sets the network and endpoint; the auction
          address identifies what to read.
        </p>
        <GuideCode
          title="read-auction.ts"
          language="TypeScript"
          code={`import { createBeaconClient, getAuctionSummary }\n  from "@hammerock/cca-sdk";\n\nasync function main() {\n  const client = createBeaconClient({\n    rpcUrl: "${RPC}",\n    chainId: 11155111,\n  });\n\n  const auction = "${AUCTION}";\n  const summary = await getAuctionSummary(client, auction);\n\n  console.log({\n    status: summary.status,\n    clearingPrice: summary.clearingPrice,\n    graduated: summary.state.isGraduated,\n    readBlock: summary.blockNumber.toString(),\n  });\n}\n\nmain().catch(console.error);`}
        />
      </GuideStep>
      <GuideStep number="03" id="guide-run" title="Run the read">
        <GuideCode title="Read from Sepolia" code="npx tsx read-auction.ts" />
        <Expectation>
          A summary object with a lifecycle status, formatted clearing price, graduation flag, and
          read block. These values come from the network and can differ from any older example.
        </Expectation>
        <p className="guide-caption">
          If the RPC rejects state overrides, use a compatible provider or pass your deployed{" "}
          <code>lensAddress</code>. No funded wallet is needed for these reads.
        </p>
      </GuideStep>
      <GuideStep number="04" id="guide-reference" title="Choose the next building block">
        <ReferenceTable
          rows={[
            [
              "getAuctionSummary",
              "Configuration, freshly calculated state, status, and remaining time.",
            ],
            [
              "getAuctionListStates",
              "Batch reads of stored contract values for directory views. These can lag a fresh lens checkpoint.",
            ],
            [
              "scanAuctions / watchAuctions",
              "Discover historical AuctionCreated events or watch for new ones.",
            ],
            [
              "formatTokenAmount / formatQ96",
              "Display token amounts and fixed-point prices with the appropriate format.",
            ],
            [
              "buildBidTransactions",
              "Prepare transaction requests, including tick alignment and needed approvals. The SDK does not sign or broadcast them.",
            ],
            [
              "@hammerock/cca-sdk/node",
              "Filesystem-backed catalogue and sync helpers for Node environments.",
            ],
          ]}
        />
        <p>
          Use a logs-capable RPC for discovery, optionally through <code>logsRpcUrl</code>. Keep
          keyed RPC endpoints in server-side environment variables when you move beyond this public
          example.
        </p>
      </GuideStep>
    </>
  );
}

function TelegramGuide() {
  return (
    <>
      <GuideIntro
        label="TELEGRAM BOT"
        title="Take the signal to your chat."
        text="Run your own bot from the repository. Each chat subscribes to auctions independently, while the process uses the same indexed catalogue as the directory."
        requirements={["Node.js 22+", "pnpm 10.23.0", "A BotFather token", "A persistent worker"]}
      />
      <GuideStep number="01" id="guide-install" title="Set up the workspace and bot">
        <WorkspaceSetup />
        <p>
          Create a bot with{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
            @BotFather
          </a>
          . Put its token in the root <code>.env</code>. Each user opens the bot and sends
          <code> /watch</code>; the bot learns their chat ID automatically. Just want to follow
          auctions? <a href="/telegram">Open the Telegram getting-started guide.</a>
        </p>
        <GuideCode
          title=".env — configure your worker"
          language="Environment"
          code={`TELEGRAM_BOT_TOKEN=replace_with_botfather_token\nBEACON_BOT_CHAINS=ethereum,base,unichain,arbitrum,sepolia\nBEACON_RPC_URL_8453=https://base-rpc.publicnode.com\nBEACON_ALERT_MINUTES_LEFT=15\nBEACON_SUBSCRIPTIONS_PATH=data/telegram-subscriptions.json`}
        />
        <p className="guide-caption">
          Keep the token on the worker. Use a persistent disk for subscriptions and run one worker
          per token. A chat ID is needed only for optional one-shot messages or seeded watches.
        </p>
      </GuideStep>
      <GuideStep number="02" id="guide-connect" title="Preview alerts, then start your bot">
        <p>
          Try a complete, fictional auction lifecycle in the terminal. This smoke test needs no
          credentials, RPC connection, or live auction, and sends no Telegram messages.
        </p>
        <GuideCode title="Preview the alert flow" code="pnpm bot:smoke" />
        <GuideCode
          title="Verify your token and webhook configuration (read-only)"
          code="pnpm bot:check"
        />
        <p>
          Once your Telegram settings are filled in, start the bot process and leave it running.
        </p>
        <GuideCode title="Start Telegram delivery" code="pnpm bot:start" />
        <GuideCode
          title="Send this to your bot in Telegram"
          language="Telegram chat"
          code={`/start\n/ping\n/suggest base\n/watch ${AUCTION} sepolia\n/status`}
        />
      </GuideStep>
      <GuideStep number="03" id="guide-run" title="Know what to expect">
        <Expectation>
          <code>/watch</code> confirms the chat subscription; <code>/status</code> returns the
          current auction state. Future status changes, threshold crossings, first clears, or
          graduation events can trigger alerts. An unchanged ended auction will not generate
          continuous updates.
        </Expectation>
        <ReferenceTable
          rows={[
            ["/ping", "Check that the worker is online."],
            [
              "/watch <address> <chain>",
              "Follow an auction on a specific network. Up to 20 per chat.",
            ],
            ["/unwatch <address> [chain]", "Remove this chat’s subscription."],
            ["/list", "List the auctions this chat follows."],
            ["/status", "Read the current state of your watched auctions."],
            ["/suggest", "Find candidates from the indexed catalogue."],
            ["/thresholds", "Show the operator-configured alert rules."],
            ["/chatid", "Show the numeric chat ID for optional operator setup."],
          ]}
        />
      </GuideStep>
      <GuideStep
        number="04"
        id="guide-reference"
        title="Tune the alerts and keep the catalogue fresh"
      >
        <ReferenceTable
          rows={[
            [
              "BEACON_ALERT_PRICE_ABOVE",
              "Optional decimal clearing-price threshold, in bid currency per token.",
            ],
            [
              "BEACON_ALERT_PRICE_BELOW",
              "Optional decimal lower-price threshold, in the same units.",
            ],
            ["BEACON_ALERT_MINUTES_LEFT", "Remaining-time alert; defaults to 15 minutes."],
            ["BEACON_POLL_INTERVAL_SECONDS", "Polling cadence; defaults to 15 seconds."],
            [
              "BEACON_SUBSCRIPTIONS_PATH",
              "Persistent per-chat subscriptions; defaults to data/telegram-subscriptions.json.",
            ],
          ]}
        />
        <p>
          Rules are configured by the bot operator and shared across chats; <code>/thresholds</code>{" "}
          displays them. If new auctions are missing from suggestions, refresh the catalogue from
          the repository root.
        </p>
        <GuideCode title="Discover new auctions" code="pnpm sync:auctions -- --chain mainnets" />
        <p className="guide-caption">
          Use a provider that supports log scanning. Restart the worker after refreshing its
          catalogue. Deploy it as a long-running process with persistent storage; Vercel hosts the
          website, while the polling bot needs its own worker. The repository’s bot README includes
          Docker deployment and recovery commands.
        </p>
      </GuideStep>
    </>
  );
}

function AgentGuide() {
  return (
    <>
      <GuideIntro
        label="BIDDING AGENT"
        title="Understand the decision before it runs."
        text="The command-line agent watches one auction against a configured price cap, bid size, total budget, and bid-count limit. Start by inspecting and simulating; broadcasting is a separate choice."
        requirements={[
          "Node.js 20.11+",
          "An RPC for a supported network",
          "An auction contract address",
        ]}
      />
      <GuideStep number="01" id="guide-install" title="Initialize your local configuration">
        <p>
          Run the setup wizard in a folder where you want to keep the agent’s <code>.env</code>. You
          do not need to clone the Beacon repository for the published CLI.
        </p>
        <GuideCode
          title="Create an agent workspace"
          code={"mkdir beacon-agent\ncd beacon-agent\nnpx @hammerock/cca-agent init"}
        />
        <p>
          The wizard asks for a network, RPC, auction address, maximum price, bid size, budget, and
          limits. It reads token decimals to convert entered amounts to base units. It does not ask
          for a private key.
        </p>
        <ReferenceTable
          rows={[
            ["AGENT_MAX_PRICE", "Highest permitted price in bid currency per token."],
            ["AGENT_BID_AMOUNT_WEI", "Currency base units used for each bid; wei for native ETH."],
            [
              "AGENT_MAX_SPEND_WEI",
              "Bid budget for this run, in currency base units. Network gas is separate; restarting resets the run’s spend counter.",
            ],
            [
              "AGENT_TRIGGER_PERCENT",
              "The distance from the price cap that activates the strategy; defaults to 10%.",
            ],
            ["AGENT_MAX_BIDS", "Maximum number of bids, independent of the budget; defaults to 3."],
          ]}
        />
      </GuideStep>
      <GuideStep number="02" id="guide-connect" title="Inspect, simulate, and read the plan">
        <GuideCode
          title="Read the auction and exercise the strategy"
          code={
            "npx @hammerock/cca-agent status\nnpx @hammerock/cca-agent simulate\nnpx @hammerock/cca-agent plan"
          }
        />
        <p>
          <code>status</code> reads the auction. <code>simulate</code> feeds a scripted price walk
          into the strategy. <code>plan</code> prints the transaction steps without sending them.
          Simulation illustrates behavior; it does not forecast a real auction.
        </p>
        <Expectation>
          An auction summary, a sequence of strategy decisions, and a readable transaction plan. A
          closed auction can be inspected, but the run loop will stop when it sees that bidding has
          ended.
        </Expectation>
      </GuideStep>
      <GuideStep number="03" id="guide-run" title="Run one decision without broadcasting">
        <GuideCode
          title="Explicit dry run — one cycle"
          code="npx @hammerock/cca-agent run --dry-run --once"
        />
        <p>
          Remove <code>--once</code> to keep watching. The explicit <code>--dry-run</code> flag
          takes precedence over both <code>--live</code> and an existing{" "}
          <code>AGENT_BROADCAST=true</code> setting.
        </p>
        <details className="guide-disclosure">
          <summary>
            Ready to understand live mode? <Icon name="chevron" width="17" height="17" />
          </summary>
          <p>
            Live mode sends real transactions. Set <code>AGENT_PRIVATE_KEY</code> in your local
            environment, use a dedicated wallet holding only your budget plus gas, and review your
            limits. Keep the key out of your frontend and version control. On a mainnet, live
            bidding stays locked until you add <code>--mainnet</code> and type the network name to
            confirm.
          </p>
          <GuideCode
            title="Broadcast mode — sends bids after confirmation"
            code="npx @hammerock/cca-agent run --live"
          />
          <p>
            The CLI asks for confirmation before live bidding. The network must be supported, the
            auction must be open, and readiness checks must pass.
          </p>
        </details>
      </GuideStep>
      <GuideStep number="04" id="guide-reference" title="Keep the controls close">
        <ReferenceTable
          rows={[
            ["--env <path>", "Load a particular environment file instead of ./.env."],
            ["--once", "Run one decision cycle and exit."],
            ["--auction <address>", "Override the auction address for the status command."],
            ["--dry-run", "Prevent broadcasts even if live mode is configured elsewhere."],
            ["plan", "Print the required transactions; never send them."],
            ["run --live", "Opt into broadcasting with an interactive confirmation."],
            ["--mainnet", "Required for live bidding or settling on a mainnet - real money."],
            [
              "settle",
              "After you are outbid or the auction ends: find your bids, plan exits and claims, simulate them. Add --live to send.",
            ],
          ]}
        />
        <p>If you already work in the repository, use the equivalent workspace command:</p>
        <GuideCode
          title="From the Beacon repository root"
          code="pnpm agent -- run --dry-run --once"
        />
        <p className="guide-caption">
          The SDK rounds bid prices down to valid ticks. ERC-20 bid currencies may require Permit2
          approval steps before submission.
        </p>
      </GuideStep>
    </>
  );
}
