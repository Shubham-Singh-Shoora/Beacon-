import { useMemo, useState } from "react";
import {
  alignPriceToTickBoundary,
  buildBidTransactions,
  checkBidReadiness,
  decimalToQ96,
  describeBidBlocker,
  getPrevTickHint,
  formatQ96,
  formatQ96Compact,
  formatTokenAmount,
  mpsToFraction,
} from "@beacon/cca-sdk";
import type { Address } from "@beacon/cca-sdk";
import { useAuction } from "./useAuction";
import { connectWallet, hasInjectedWallet } from "./wallet";
import type { ConnectedWallet } from "./wallet";
import { styles } from "./styles";

export interface AuctionCardProps {
  /** Address of the ContinuousClearingAuction to display. */
  auction: Address;
  /** Public RPC the widget reads through. Never put a keyed URL here - the
   *  widget runs in the visitor's browser. */
  rpcUrl: string;
  /** Chain id the auction lives on. Must be a supported testnet. */
  chainId: number;
  /** Optional deployed AuctionStateLens. Omit to use the eth_call override. */
  lensAddress?: Address;
  /** How often to re-read live state, in ms. */
  pollIntervalMs?: number;
  /** Hide the bid form and render read-only. */
  readOnly?: boolean;
}

type TxState =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "sent"; hash: string }
  | { kind: "error"; message: string };

export function AuctionCard(props: AuctionCardProps) {
  const { data, error, loading, client, refresh } = useAuction(props);

  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [maxPrice, setMaxPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [tx, setTx] = useState<TxState>({ kind: "idle" });

  const parsed = useMemo(() => {
    let maxPriceQ96 = 0n;
    let amountUnits = 0n;
    let parseError: string | null = null;

    try {
      if (maxPrice.trim()) maxPriceQ96 = decimalToQ96(maxPrice.trim());
    } catch {
      parseError = "Maximum price must be a decimal number.";
    }

    if (amount.trim() && data) {
      const decimals = data.currency.decimals;
      if (!/^\d+(\.\d+)?$/.test(amount.trim())) {
        parseError = "Bid amount must be a decimal number.";
      } else {
        const [whole = "0", frac = ""] = amount.trim().split(".");
        const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
        amountUnits = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
      }
    }

    return { maxPriceQ96, amountUnits, parseError };
  }, [maxPrice, amount, data]);

  if (loading && !data) {
    return (
      <div style={styles.card}>
        <div style={styles.muted}>Loading auction…</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={styles.card}>
        <div style={styles.error}>Could not load auction</div>
        <div style={styles.muted}>{error.message.split("\n")[0]}</div>
      </div>
    );
  }

  if (!data) return null;

  const { info, state, token, currency, status } = data;
  const hasCleared = state.totalCleared > 0n;
  const schedulePercent = (mpsToFraction(state.checkpoint.cumulativeMps) * 100).toFixed(0);

  // The single source of truth for whether bidding is possible. An ended
  // auction disables the button with a stated reason rather than failing on
  // submit, which is the common way these embeds break.
  const blocker = describeBidBlocker({
    status,
    amount: parsed.amountUnits,
    maxPriceQ96: parsed.maxPriceQ96,
    floorPriceQ96: info.floorPriceQ96,
    tickSpacing: info.tickSpacing,
  });

  // The contract only accepts prices on a tick boundary, so show the bidder the
  // price that will actually be submitted rather than surprising them later.
  const alignedPriceQ96 =
    parsed.maxPriceQ96 > 0n
      ? alignPriceToTickBoundary(parsed.maxPriceQ96, info.tickSpacing)
      : 0n;
  const priceWasSnapped = alignedPriceQ96 > 0n && alignedPriceQ96 !== parsed.maxPriceQ96;

  const bidDisabled =
    props.readOnly ||
    status !== "live" ||
    tx.kind === "working" ||
    parsed.parseError !== null ||
    blocker !== null;

  async function onConnect() {
    if (!client) return;
    setTx({ kind: "working", message: "Connecting wallet…" });
    try {
      setWallet(await connectWallet(client.chain));
      setTx({ kind: "idle" });
    } catch (cause) {
      setTx({ kind: "error", message: (cause as Error).message });
    }
  }

  async function onSubmitBid() {
    if (!client || !wallet || !data) return;

    try {
      setTx({ kind: "working", message: "Checking balance…" });

      const readiness = await checkBidReadiness(client, {
        auction: props.auction,
        currency: data.info.currency,
        bidder: wallet.address,
        amount: parsed.amountUnits,
      });

      if (!readiness.hasBalance) {
        setTx({
          kind: "error",
          message: `Insufficient ${data.currency.symbol}. You hold ${formatTokenAmount(readiness.balance, data.currency)}.`,
        });
        return;
      }

      // ERC-20 bids go through Permit2, so there may be two approvals before
      // the bid itself. buildBidTransactions returns exactly the steps needed.
      const prevTickPriceQ96 = await getPrevTickHint(client, props.auction, parsed.maxPriceQ96);

      const steps = buildBidTransactions({
        auction: props.auction,
        currency: data.info.currency,
        maxPriceQ96: parsed.maxPriceQ96,
        amount: parsed.amountUnits,
        owner: wallet.address,
        readiness,
        prevTickPriceQ96,
        // Snapped DOWN to a tick boundary; the contract rejects any other price.
        tickSpacing: data.info.tickSpacing,
      });

      let hash = "" as `0x${string}`;
      for (const [index, step] of steps.entries()) {
        setTx({ kind: "working", message: `${step.label} (${index + 1}/${steps.length})…` });
        hash = await wallet.walletClient.sendTransaction({
          account: wallet.address,
          chain: client.chain,
          to: step.request.to,
          data: step.request.data,
          value: step.request.value,
        });
        // Approvals must land before the next step can read them.
        if (index < steps.length - 1) {
          await client.publicClient.waitForTransactionReceipt({ hash });
        }
      }

      setTx({ kind: "sent", hash });
      refresh();
    } catch (cause) {
      const message = (cause as Error).message.split("\n")[0] ?? "Transaction failed.";
      setTx({ kind: "error", message });
    }
  }

  const explorer = client?.chain.blockExplorers?.default?.url;

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.symbol}>{token.symbol}</div>
          <div style={styles.muted}>{token.name}</div>
        </div>
        <StatusPill status={status} isGraduated={state.isGraduated} />
      </div>

      <div style={styles.priceBlock}>
        <div style={styles.label}>Clearing price</div>
        <div style={styles.price}>
          {formatQ96Compact(state.checkpoint.clearingPriceQ96)}{" "}
          <span style={styles.priceUnit}>
            {currency.symbol} / {token.symbol}
          </span>
        </div>
      </div>

      <dl style={styles.grid}>
        <Row label="Raised" value={formatTokenAmount(state.currencyRaised, currency)} />
        <Row
          label="Cleared"
          value={
            hasCleared
              ? `${formatTokenAmount(state.totalCleared, token)} of ${formatTokenAmount(info.totalSupply, token)}`
              : "Nothing cleared"
          }
        />
        <Row
          label="Supply schedule"
          value={`${schedulePercent}% released`}
          hint="Schedule progress, not the amount sold."
        />
        <Row
          label={status === "pending" ? "Starts in" : status === "live" ? "Time left" : "Closed"}
          value={
            status === "ended"
              ? `block ${info.endBlock.toString()}`
              : `~${formatMinutes(data.secondsRemaining)} (${data.blocksRemaining.toString()} blocks)`
          }
        />
      </dl>

      {props.readOnly ? null : (
        <div style={styles.form}>
          {status !== "live" ? (
            // Say why, rather than showing a button that would revert.
            <div style={styles.notice}>
              {status === "ended"
                ? "This auction has ended. Bidding is closed."
                : "This auction has not opened yet."}
            </div>
          ) : (
            <>
              <label style={styles.label} htmlFor="beacon-max-price">
                Max price ({currency.symbol} per {token.symbol})
              </label>
              <input
                id="beacon-max-price"
                style={styles.input}
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
                placeholder={formatQ96(info.floorPriceQ96)}
                inputMode="decimal"
              />

              {priceWasSnapped ? (
                <div style={styles.muted}>
                  Will bid at {formatQ96Compact(alignedPriceQ96)} {currency.symbol} — prices snap
                  down to the auction&apos;s tick spacing.
                </div>
              ) : null}

              <label style={styles.label} htmlFor="beacon-amount">
                Bid amount ({currency.symbol})
              </label>
              <input
                id="beacon-amount"
                style={styles.input}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.0"
                inputMode="decimal"
              />
            </>
          )}

          {wallet === null ? (
            <button
              type="button"
              style={{ ...styles.button, ...(status !== "live" ? styles.buttonDisabled : {}) }}
              disabled={status !== "live" || !hasInjectedWallet()}
              onClick={() => void onConnect()}
            >
              {hasInjectedWallet() ? "Connect wallet" : "No browser wallet detected"}
            </button>
          ) : (
            <button
              type="button"
              style={{ ...styles.button, ...(bidDisabled ? styles.buttonDisabled : {}) }}
              disabled={bidDisabled}
              onClick={() => void onSubmitBid()}
              title={blocker ?? undefined}
            >
              {tx.kind === "working" ? tx.message : "Submit bid"}
            </button>
          )}

          {wallet ? (
            <div style={styles.muted}>
              Connected {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
            </div>
          ) : null}

          {parsed.parseError ? <div style={styles.error}>{parsed.parseError}</div> : null}
          {blocker && status === "live" && !parsed.parseError ? (
            <div style={styles.muted}>{blocker}</div>
          ) : null}

          {tx.kind === "error" ? <div style={styles.error}>{tx.message}</div> : null}
          {tx.kind === "sent" ? (
            <div style={styles.success}>
              Bid submitted.{" "}
              {explorer ? (
                <a
                  href={`${explorer}/tx/${tx.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.link}
                >
                  View transaction
                </a>
              ) : (
                tx.hash
              )}
            </div>
          ) : null}
        </div>
      )}

      <div style={styles.footer}>
        Powered by <strong>Beacon</strong> · Uniswap CCA
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={styles.row}>
      <dt style={styles.label} title={hint}>
        {label}
      </dt>
      <dd style={styles.value}>{value}</dd>
    </div>
  );
}

function StatusPill({ status, isGraduated }: { status: string; isGraduated: boolean }) {
  const palette =
    status === "live"
      ? styles.pillLive
      : status === "pending"
        ? styles.pillPending
        : styles.pillEnded;

  return (
    <div style={styles.pillRow}>
      <span style={{ ...styles.pill, ...palette }}>
        {status === "live" ? "Live" : status === "pending" ? "Upcoming" : "Ended"}
      </span>
      {isGraduated ? <span style={{ ...styles.pill, ...styles.pillGraduated }}>Graduated</span> : null}
    </div>
  );
}

function formatMinutes(seconds: number): string {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
