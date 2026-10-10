import Link from "next/link";
import { BeaconMark, Icon } from "@/components/Icons";
import { CopyButton } from "@/components/CopyButton";

export const metadata = {
  title: "Telegram auction alerts",
  description:
    "Follow auctions with @Beacon_uniswapBot. A step-by-step guide to Telegram commands, network selection, and auction alerts.",
};

const commands = [
  ["/ping", "Check the connection", "A reply confirms that the bot’s worker is online."],
  [
    "/suggest base",
    "Find an auction",
    "Browse indexed auctions on Base. Try ethereum, unichain, arbitrum, or sepolia too.",
  ],
  [
    "/list",
    "See your watch list",
    "Subscriptions belong to this chat and stay saved across worker restarts.",
  ],
  [
    "/status",
    "Get the latest state",
    "Read the current clearing price, funds raised, and lifecycle of your watched auctions.",
  ],
  [
    "/thresholds",
    "Know your alert rules",
    "See the operator’s price and time thresholds. Rules are shared across chats.",
  ],
  [
    "/help",
    "Find every command",
    "Get help, including how to stop following an auction with /unwatch.",
  ],
];

export default function TelegramPage() {
  return (
    <main id="main-content" className="page-width telegram-page">
      <section className="telegram-hero">
        <div className="telegram-hero-copy reveal">
          <span className="eyebrow">
            <Icon name="sparkles" width="15" height="15" /> THE SIGNAL, WHERE YOU ARE
          </span>
          <h1>
            Less refreshing.
            <br />
            <span>More discovering.</span>
          </h1>
          <p>
            Take your watch list with you. Follow onchain auctions and catch the changes that
            matter, right in Telegram.
          </p>
          <a
            className="button button-primary"
            href="https://t.me/Beacon_uniswapBot"
            target="_blank"
            rel="noreferrer"
          >
            Open Beacon on Telegram <Icon name="external" />
          </a>
          <span className="telegram-handle">
            @Beacon_uniswapBot <span>·</span> Read-only. No wallet needed.
          </span>
        </div>
        <div
          className="telegram-preview reveal"
          aria-label="Illustrative Telegram conversation, not live data"
        >
          <div className="telegram-preview-header">
            <span className="telegram-avatar">
              <BeaconMark />
            </span>
            <div>
              <strong>Beacon</strong>
              <span>your auction companion</span>
            </div>
            <span className="telegram-preview-label">PREVIEW</span>
          </div>
          <div className="telegram-chat-body">
            <div className="telegram-bubble telegram-bubble-out">
              <code>/suggest base</code>
              <small>You</small>
            </div>
            <div className="telegram-bubble">
              <span className="telegram-chat-kicker">A LITTLE DISCOVERY</span>
              <strong>Find your next auction.</strong>
              <p>Choose a network. Explore its catalogue. Follow what catches your eye.</p>
              <small>Beacon</small>
            </div>
            <div className="telegram-bubble telegram-bubble-out">
              <code>/watch &lt;address&gt; base</code>
              <small>You</small>
            </div>
            <div className="telegram-bubble telegram-bubble-signal">
              <Icon name="sparkles" />
              <div>
                <strong>Stay close to the moment.</strong>
                <p>
                  First clears. Price crossings. Graduation.
                  <br />A heads-up as the auction closes.
                </p>
              </div>
            </div>
          </div>
          <div className="telegram-preview-foot">
            <span /> A preview of the experience. Your alerts follow real onchain changes.
          </div>
        </div>
      </section>

      <section className="telegram-start" aria-labelledby="telegram-start-title">
        <div className="journey-heading">
          <div>
            <span className="eyebrow">THREE SMALL STEPS</span>
            <h2 id="telegram-start-title">From curious to connected.</h2>
          </div>
          <span className="handbook-label">
            YOUR FIRST WATCH LIST <Icon name="arrow" width="16" height="16" />
          </span>
        </div>
        <div className="telegram-steps">
          <article>
            <span className="telegram-step-number">01</span>
            <h3>Say hello.</h3>
            <p>
              Open the bot, tap <strong>Start</strong>, then send <code>/ping</code>. A reply
              confirms the worker is connected.
            </p>
            <CopyButton text="/ping" label="Copy /ping" />
          </article>
          <article>
            <span className="telegram-step-number">02</span>
            <h3>Find your signal.</h3>
            <p>
              Send <code>/suggest base</code> or choose an auction in the directory. Copy its
              contract address and note its network.
            </p>
            <Link className="text-link" href="/#auctions">
              Explore the directory <Icon name="arrow" width="16" height="16" />
            </Link>
          </article>
          <article>
            <span className="telegram-step-number">03</span>
            <h3>Make it a watch.</h3>
            <p>
              Send <code>/watch &lt;address&gt; base</code>, replacing the address and network. The
              bot confirms a verified subscription.
            </p>
            <span className="telegram-step-note">
              <Icon name="check" width="15" height="15" /> Up to 20 auctions per chat
            </span>
          </article>
        </div>
      </section>

      <section className="telegram-reference" aria-labelledby="telegram-commands-title">
        <div className="telegram-reference-intro">
          <span className="eyebrow">A SMALL COMMAND. A CLEARER VIEW.</span>
          <h2 id="telegram-commands-title">Your field guide.</h2>
          <p>Copy a command, paste it into the bot, and keep exploring.</p>
          <div className="telegram-network-note">
            <Icon name="layers" />
            <span>
              Ethereum · Base · Unichain · Arbitrum
              <br />
              <small>Plus Sepolia for testnet exploration.</small>
            </span>
          </div>
        </div>
        <div className="telegram-command-list">
          {commands.map(([command, title, description]) => (
            <article key={command}>
              <div>
                <code>{command}</code>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <CopyButton text={command!} label={`Copy ${command}`} />
            </article>
          ))}
        </div>
      </section>

      <section className="telegram-notes" aria-label="Connection and alert help">
        <article>
          <Icon name="clock" />
          <h3>No reply yet?</h3>
          <p>
            A Telegram username can exist while its worker is offline. Tap Start and try{" "}
            <code>/ping</code>. If it stays silent, hosting needs attention; there is no connection
            confirmed from this page.
          </p>
          <Link href="/developers?tool=telegram#choose-tool" className="text-link">
            Worker setup & diagnostics <Icon name="arrow" width="16" height="16" />
          </Link>
        </article>
        <article>
          <Icon name="sparkles" />
          <h3>Quiet can be normal.</h3>
          <p>
            Alerts follow changes after the first observation. Ended or unchanged auctions stay
            quiet. Delivery depends on RPC and Telegram availability; use <code>/status</code> for a
            fresh read.
          </p>
          <Link href="/learn" className="text-link">
            Understand the lifecycle <Icon name="arrow" width="16" height="16" />
          </Link>
        </article>
      </section>
    </main>
  );
}
