/**
 * `cca-agent settle` - exit bids and claim tokens.
 *
 * A CCA never pays anyone automatically: refunds and tokens wait in the auction
 * until someone calls exit and claim. Anyone may do that for any bid and the
 * contract always pays the bid's owner, so the wallet here only pays gas - it
 * can be a different wallet from the one that bid (`--owner`).
 *
 * Dry run by default: it finds the bids, decides what each needs, and
 * simulates every transaction against the live contract. `--live` sends them,
 * under the same mainnet lock as bidding.
 */
import * as p from "@clack/prompts";
import { createWalletClient, http, isAddress } from "viem";
import type { Address, PrivateKeyAccount } from "viem";
import {
  assertChainMatches,
  createBeaconClient,
  findBidIds,
  formatQ96,
  formatTokenAmount,
  getAuctionInfo,
  getAuctionState,
  planSettlement,
  readSettleState,
  rpcSettingsFromEnv,
} from "@hammerock/cca-sdk";
import type { BeaconClient, SettleTx, SettlementPlan } from "@hammerock/cca-sdk";
import { ConfigError, isMainnetChain, loadAccount, MAINNET_CHAIN_IDS, TESTNET_CHAIN_IDS } from "./config";
import type { AgentConfig } from "./config";
import { GuardError, assertChainAllowed } from "./guards";
import { CMD } from "./invocation";
import { BRAND, auctionCard, pc, shortAddress } from "./ui";
import type { AuctionView } from "./ui";
import { readAuctionView } from "./view";

export interface SettleArgs {
  flags: string[];
  auction?: string;
  owner?: string;
  bidIds?: string;
  yes: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  exit: pc.green("exit"),
  exitPartial: pc.green("exit (partial)"),
  claim: pc.green("claim"),
  wait: pc.yellow("wait"),
  done: pc.dim("done"),
};

function q96ToAmount(q96: bigint): bigint {
  return q96 >> 96n;
}

function bidTable(plan: SettlementPlan, view: AuctionView): string {
  if (plan.bids.length === 0) return pc.dim("No bids.");
  return plan.bids
    .map(({ bid, action }) => {
      const owed =
        bid.tokensFilled > 0n ? `  ${pc.dim("owed")} ${formatTokenAmount(bid.tokensFilled, view.token)}` : "";
      return (
        `${pc.bold(`#${bid.id}`.padEnd(6))}${ACTION_LABEL[action.kind]!.padEnd(26)} ` +
        `${formatTokenAmount(q96ToAmount(bid.amountQ96), view.currency)} at ≤ ${formatQ96(bid.maxPriceQ96)}${owed}\n` +
        `      ${pc.dim(action.reason)}`
      );
    })
    .join("\n");
}

async function simulate(client: BeaconClient, tx: SettleTx, from: Address): Promise<string | undefined> {
  try {
    await client.publicClient.call({ to: tx.to, data: tx.data, account: from });
    return undefined;
  } catch (error) {
    return (error as Error).message.split("\n")[0];
  }
}

export async function runSettle(args: SettleArgs): Promise<void> {
  const flags = new Set(args.flags);
  const chainId = Number(process.env.BEACON_CHAIN_ID ?? 11155111);
  if (!TESTNET_CHAIN_IDS.has(chainId) && !MAINNET_CHAIN_IDS.has(chainId)) {
    throw new ConfigError(`BEACON_CHAIN_ID ${chainId} is not supported.`);
  }
  const rpc = rpcSettingsFromEnv(chainId);
  const rpcUrl = rpc.rpcUrl;

  const auction = args.auction ?? process.env.AGENT_AUCTION_ADDRESS;
  if (!auction || !isAddress(auction)) {
    throw new ConfigError(`No auction. Pass --auction 0x… or run "${CMD} init".`);
  }

  const live = flags.has("--live") && !flags.has("--dry-run");
  const allowMainnet =
    flags.has("--mainnet") || (process.env.AGENT_ALLOW_MAINNET ?? "false").trim().toLowerCase() === "true";
  if (live && isMainnetChain(chainId) && !allowMainnet) {
    throw new ConfigError(
      `Chain ${chainId} is a MAINNET. Settling only moves money back to bidders, but it\n` +
        "  sends real transactions and costs real gas. Opt in with --mainnet or AGENT_ALLOW_MAINNET=true.",
    );
  }

  // The key only pays gas, and is only needed to send.
  const account: PrivateKeyAccount | undefined = loadAccount(live);
  const owner = args.owner ?? account?.address;
  if (!owner || !isAddress(owner)) {
    throw new ConfigError(
      "Whose bids? Pass --owner 0x… (any address - settling pays the owner), or set AGENT_PRIVATE_KEY to use your own.",
    );
  }

  const client = createBeaconClient({ chainId, rpcUrl, fallbackRpcUrls: rpc.fallbackRpcUrls });
  p.intro(BRAND);
  const spin = p.spinner();
  spin.start("Checking network and auction");
  await assertChainAllowed(client, { chainId, broadcast: live, allowMainnet } as AgentConfig);
  await assertChainMatches(client);
  const view = await readAuctionView(client, auction as Address);
  spin.stop(`Connected to ${client.chain.name}${isMainnetChain(chainId) ? pc.yellow("  (mainnet)") : ""}`);
  p.note(auctionCard(view), "Auction");

  const findSpin = p.spinner();
  let ids: bigint[];
  if (args.bidIds) {
    ids = args.bidIds.split(",").map((s) => {
      if (!/^\d+$/.test(s.trim())) throw new ConfigError(`--bid: "${s}" is not a bid id.`);
      return BigInt(s.trim());
    });
  } else {
    findSpin.start(`Finding bids owned by ${shortAddress(owner)}`);
    ids = await findBidIds(client, auction as Address, owner as Address, {
      onProgress: (read, total) => findSpin.message(`Reading bids ${read}/${total}`),
    });
    findSpin.stop(`${ids.length} bid(s) owned by ${shortAddress(owner)}`);
  }
  if (ids.length === 0) {
    p.outro("Nothing to settle.");
    return;
  }

  async function plan(onProgress?: (message: string) => void): Promise<SettlementPlan> {
    const [info, liveState] = await Promise.all([
      getAuctionInfo(client, auction as Address),
      getAuctionState(client, auction as Address),
    ]);
    const state = await readSettleState(client, auction as Address, {
      clearingPriceQ96: liveState.checkpoint.clearingPriceQ96,
      graduated: liveState.isGraduated,
      endBlock: info.endBlock,
    });
    return planSettlement(client, auction as Address, owner as Address, ids, state, { onProgress });
  }

  const planSpin = p.spinner();
  planSpin.start("Working out what each bid needs");
  let current = await plan((m) => planSpin.message(`Working out what each bid needs - ${m}`));
  planSpin.stop("Plan ready");
  p.note(bidTable(current, view), "Bids");

  const txs = [...current.exits, ...(current.claim ? [current.claim] : [])];
  if (txs.length === 0) {
    p.outro("Nothing to send right now.");
    return;
  }

  // Simulate from the wallet that would pay (or the owner, in a dry run).
  const from = (account?.address ?? owner) as Address;
  const simSpin = p.spinner();
  simSpin.start("Simulating against the live contract");
  const results = await Promise.all(txs.map(async (tx) => ({ tx, error: await simulate(client, tx, from) })));
  simSpin.stop("Simulated");
  p.note(
    results
      .map(({ tx, error }) => (error ? `${pc.red("✗")} ${tx.label}\n  ${pc.dim(error)}` : `${pc.green("✓")} ${tx.label}`))
      .join("\n"),
    "Transactions",
  );
  if (results.some((r) => r.error)) {
    throw new GuardError("A settlement transaction would revert - nothing was sent. See the reason above.");
  }

  if (!live) {
    p.outro(`Dry run - nothing sent. Add ${pc.cyan("--live")} to send these.`);
    return;
  }

  p.log.warn(
    `Sending from ${pc.bold(account!.address)} - it pays gas only. ` +
      `Refunds and tokens go to the bid owner, ${pc.bold(owner)}.`,
  );
  if (!args.yes) {
    if (!process.stdin.isTTY) throw new ConfigError("Re-run with --yes to confirm non-interactively.");
    const ok = await p.confirm({ message: `Send ${txs.length} transaction(s)?`, initialValue: false });
    if (p.isCancel(ok) || !ok) {
      p.cancel("Stopped - nothing was sent.");
      return;
    }
  }

  const wallet = createWalletClient({ account: account!, chain: client.chain, transport: http(rpcUrl) });
  const explorer = client.chain.blockExplorers?.default?.url;
  const send = async (tx: SettleTx) => {
    const s = p.spinner();
    s.start(tx.label);
    const hash = await wallet.sendTransaction({ account: account!, chain: client.chain, to: tx.to, data: tx.data });
    const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      s.error(`${tx.label} reverted`);
      throw new GuardError(`${tx.label} reverted on-chain: ${hash}`);
    }
    s.stop(`${tx.label}  ${pc.dim(explorer ? `${explorer}/tx/${hash}` : hash)}`);
  };

  for (const tx of current.exits) await send(tx);

  // Exits set tokensFilled; re-plan so freshly exited bids are claimed too.
  if (current.exits.length > 0) current = await plan();
  if (current.claim) {
    const error = await simulate(client, current.claim, account!.address);
    if (error) throw new GuardError(`Claim would revert - not sent: ${error}`);
    await send(current.claim);
  }

  const waiting = current.bids.filter((b) => b.action.kind === "wait");
  p.outro(
    waiting.length > 0
      ? `Settled what is ready. ${waiting.length} bid(s) still waiting - run settle again later.`
      : "All settled.",
  );
}
