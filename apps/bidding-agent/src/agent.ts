/**
 * The agent runtime: read state, ask the strategy, build the transactions,
 * and either broadcast them or describe them.
 *
 * All transaction construction comes from @beacon/cca-sdk's `write.ts` -
 * `checkBidReadiness`, `getPrevTickHint` and `buildBidTransactions`. The agent
 * contains no encoding of its own, so the ERC-20 Permit2 flow and the native
 * `msg.value` rule are handled in exactly one place, shared with the widget.
 */
import {
  buildBidTransactions,
  checkBidReadiness,
  formatQ96,
  formatTokenAmount,
  getAuctionInfo,
  getAuctionState,
  getPrevTickHint,
  getTokenMetadata,
  deriveStatus,
  NATIVE_CURRENCY,
} from "@beacon/cca-sdk";
import type { AuctionInfo, BeaconClient, TokenMetadata } from "@beacon/cca-sdk";
import { createWalletClient, http } from "viem";
import type { Hex } from "viem";
import type { AgentConfig } from "./config";
import { assertSufficientBalance, assertWithinPriceCap, assertWithinSpendCap } from "./guards";
import { applyBid, decide, triggerThresholdQ96 } from "./strategy";
import type { Decision, MarketSnapshot, StrategyState } from "./strategy";

export interface AgentContext {
  client: BeaconClient;
  config: AgentConfig;
  info: AuctionInfo;
  token: TokenMetadata;
  currency: TokenMetadata;
}

export interface TickResult {
  market: MarketSnapshot;
  decision: Decision;
  /** Populated when a bid was decided: the transactions it would take. */
  plan?: Array<{ label: string; to: string; value: bigint; dataPreview: string }>;
  /** Populated when a bid was actually broadcast. */
  hashes?: Hex[];
  state: StrategyState;
}

export async function loadContext(
  client: BeaconClient,
  config: AgentConfig,
): Promise<AgentContext> {
  const info = await getAuctionInfo(client, config.auction);
  const [token, currency] = await Promise.all([
    getTokenMetadata(client, info.token),
    getTokenMetadata(client, info.currency),
  ]);
  return { client, config, info, token, currency };
}

/** Read the auction and turn it into the snapshot the strategy consumes. */
export async function readMarket(context: AgentContext): Promise<MarketSnapshot> {
  const [state, headBlock] = await Promise.all([
    getAuctionState(context.client, context.config.auction),
    context.client.publicClient.getBlockNumber(),
  ]);

  return {
    status: deriveStatus(context.info, headBlock),
    clearingPriceQ96: state.checkpoint.clearingPriceQ96,
    floorPriceQ96: context.info.floorPriceQ96,
  };
}

function previewData(data: Hex): string {
  return `${data.slice(0, 10)}…${data.length > 74 ? data.slice(-8) : ""} (${(data.length - 2) / 2} bytes)`;
}

/**
 * One decision cycle.
 *
 * When `config.broadcast` is false this still does everything except send:
 * it reads real state, runs the real strategy, checks real allowances and
 * builds the real calldata. That makes the logic provable without a live
 * auction to bid into.
 */
export async function tick(
  context: AgentContext,
  state: StrategyState,
  options: { onLog?: (message: string) => void } = {},
): Promise<TickResult> {
  const { client, config } = context;
  const market = await readMarket(context);
  const decision = decide(market, config.strategy, state);

  if (decision.action === "wait") {
    return { market, decision, state };
  }

  // --- guardrails, before any transaction is built or sent -----------------
  assertWithinPriceCap({
    maxPriceQ96: config.strategy.maxPriceQ96,
    submittedPriceQ96: decision.maxPriceQ96,
  });
  assertWithinSpendCap({
    spent: state.spent,
    amount: decision.amount,
    maxSpend: config.strategy.maxSpend,
  });

  const bidder = config.account?.address;
  if (!bidder) {
    // Dry runs without a key can still prove construction, using the auction
    // itself as a stand-in owner so the calldata is well formed.
    options.onLog?.("No AGENT_PRIVATE_KEY set - building the plan with a placeholder owner.");
  }
  const owner = bidder ?? config.auction;

  const readiness = await checkBidReadiness(client, {
    auction: config.auction,
    currency: context.info.currency,
    bidder: owner,
    amount: decision.amount,
  });

  if (bidder) {
    assertSufficientBalance({
      balance: readiness.balance,
      amount: decision.amount,
      symbol: context.currency.symbol,
    });
  }

  const prevTickPriceQ96 = await getPrevTickHint(client, config.auction, decision.maxPriceQ96);

  const steps = buildBidTransactions({
    auction: config.auction,
    currency: context.info.currency,
    maxPriceQ96: decision.maxPriceQ96,
    amount: decision.amount,
    owner,
    readiness,
    prevTickPriceQ96,
  });

  const plan = steps.map((step) => ({
    label: step.label,
    to: step.request.to,
    value: step.request.value,
    dataPreview: previewData(step.request.data),
  }));

  if (!config.broadcast) {
    options.onLog?.(
      `DRY RUN - would send ${steps.length} transaction(s); nothing was broadcast.`,
    );
    return { market, decision, plan, state: applyBid(state, decision.amount) };
  }

  // --- broadcast -----------------------------------------------------------
  const account = config.account!;
  const wallet = createWalletClient({
    account,
    chain: client.chain,
    transport: http(config.rpcUrl),
  });

  const hashes: Hex[] = [];
  for (const [index, step] of steps.entries()) {
    options.onLog?.(`sending ${index + 1}/${steps.length}: ${step.label}`);
    const hash = await wallet.sendTransaction({
      account,
      chain: client.chain,
      to: step.request.to,
      data: step.request.data,
      value: step.request.value,
    });
    hashes.push(hash);
    // Approvals must land before the next step reads them.
    if (index < steps.length - 1) {
      await client.publicClient.waitForTransactionReceipt({ hash });
    }
  }

  return { market, decision, plan, hashes, state: applyBid(state, decision.amount) };
}

/** Human-readable one-liner describing the agent's configuration. */
export function describeStrategy(context: AgentContext): string {
  const { config, currency, token } = context;
  const threshold = triggerThresholdQ96(config.strategy.maxPriceQ96, config.strategy.triggerBps);

  return [
    `cap        ${config.strategy.maxPriceInput} (${formatQ96(config.strategy.maxPriceQ96)}) ${currency.symbol}/${token.symbol}`,
    `trigger at ${formatQ96(threshold)} (within ${config.strategy.triggerBps / 100}% of cap)`,
    `bid size   ${formatTokenAmount(config.strategy.bidAmount, currency)}`,
    `max spend  ${formatTokenAmount(config.strategy.maxSpend, currency)}`,
    `max bids   ${config.strategy.maxBids}`,
    `currency   ${currency.symbol} ${
      context.info.currency === NATIVE_CURRENCY
        ? "(native - bid sends msg.value)"
        : "(ERC-20 - bid needs Permit2 approvals)"
    }`,
  ].join("\n  ");
}

/**
 * Build the transaction plan for the configured bid, IGNORING the lifecycle
 * gate, so the calldata can be inspected without a live auction.
 *
 * Dry-run only - it never broadcasts, and `tick()` remains the only path that
 * can send. This exists because every CCA auction on Sepolia has already
 * closed, which means `decide()` correctly refuses to bid and the construction
 * path would otherwise never be exercised.
 */
export async function buildPlanForInspection(context: AgentContext): Promise<{
  steps: Array<{ label: string; to: string; value: bigint; data: Hex }>;
  isNative: boolean;
  readiness: Awaited<ReturnType<typeof checkBidReadiness>>;
  prevTickPriceQ96: bigint;
}> {
  const { client, config } = context;
  const owner = config.account?.address ?? config.auction;

  assertWithinPriceCap({
    maxPriceQ96: config.strategy.maxPriceQ96,
    submittedPriceQ96: config.strategy.maxPriceQ96,
  });
  assertWithinSpendCap({
    spent: 0n,
    amount: config.strategy.bidAmount,
    maxSpend: config.strategy.maxSpend,
  });

  const readiness = await checkBidReadiness(client, {
    auction: config.auction,
    currency: context.info.currency,
    bidder: owner,
    amount: config.strategy.bidAmount,
  });

  const prevTickPriceQ96 = await getPrevTickHint(
    client,
    config.auction,
    config.strategy.maxPriceQ96,
  );

  const steps = buildBidTransactions({
    auction: config.auction,
    currency: context.info.currency,
    maxPriceQ96: config.strategy.maxPriceQ96,
    amount: config.strategy.bidAmount,
    owner,
    readiness,
    prevTickPriceQ96,
  }).map((step) => ({
    label: step.label,
    to: step.request.to,
    value: step.request.value,
    data: step.request.data,
  }));

  return { steps, isNative: context.info.currency === NATIVE_CURRENCY, readiness, prevTickPriceQ96 };
}
