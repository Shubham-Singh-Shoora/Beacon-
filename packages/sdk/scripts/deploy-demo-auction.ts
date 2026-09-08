/**
 * Deploy Beacon's own demo CCA auction.
 *
 *   pnpm deploy:demo -- --dry-run    print the plan and validate, send nothing
 *   pnpm deploy:demo                 deploy for real (needs a funded key)
 *
 * Every CCA auction on Sepolia has already closed, so the bot's alerts, the
 * widget's bid form and the agent's `submitBid` have nothing live to act on.
 * This creates one under our control.
 *
 * The flow, in the order the contracts require:
 *   1. deploy a demo ERC-20, minting the whole supply to the deployer
 *   2. factory.initializeDistribution(token, amount, configData, salt)
 *      -> creates the auction, emits AuctionCreated
 *   3. transfer the supply to the new auction
 *   4. auction.onTokensReceived()  -> the auction will not accept bids until this
 *
 * TESTNET ONLY. Refuses any chain outside the allowlist, and the deployer key
 * is read from the environment and never logged.
 */
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  auctionAbi,
  auctionCreatedEvent,
  buildAuctionSteps,
  createBeaconClient,
  encodeAuctionParameters,
  factoryAbi,
  formatQ96,
  normalizePrivateKey,
  packAuctionSteps,
  totalBlocks,
  totalMps,
} from "../src/index";
import { demoTokenAbi, demoTokenBytecode } from "../src/demo/token";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
loadEnv({ path: resolve(repoRoot, ".env"), quiet: true });

const ALLOWED_CHAIN_IDS = new Set([11155111, 84532, 1301, 31337]);

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};

const DRY_RUN = flag("dry-run");
const RPC_URL = arg("rpc", process.env.BEACON_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com");
const CHAIN_ID = Number(arg("chain-id", process.env.BEACON_CHAIN_ID ?? "11155111"));

// --- demo auction shape ----------------------------------------------------
// Mirrors the parameters real Sepolia auctions used, so the demo behaves like
// its neighbours in the directory rather than being a special case.
const TOKEN_NAME = arg("name", "Beacon Demo");
const TOKEN_SYMBOL = arg("symbol", "BEACON");
const TOTAL_SUPPLY = parseEther(arg("supply", "1000"));
/** Blocks the auction stays open. ~12s per block on Sepolia. */
const DURATION_BLOCKS = Number(arg("duration", "1200"));
/** Blocks to wait before the auction opens, so there is time to wire things up. */
const START_DELAY_BLOCKS = Number(arg("start-delay", "5"));
const TICK_SPACING = BigInt(arg("tick-spacing", "100000"));
const FLOOR_PRICE = BigInt(arg("floor-price", "4295000000"));
/** Currency that must be raised to graduate. 0 means it graduates on any fill. */
const REQUIRED_RAISED = BigInt(arg("required-raised", "0"));

function log(message = ""): void {
  console.log(message);
}

async function main(): Promise<void> {
  log("=".repeat(66));
  log("Beacon demo auction deployment - TESTNET ONLY");
  log("=".repeat(66));

  if (!ALLOWED_CHAIN_IDS.has(CHAIN_ID)) {
    throw new Error(
      `Refusing to deploy to chain id ${CHAIN_ID}. Allowed: ${[...ALLOWED_CHAIN_IDS].join(", ")}.`,
    );
  }

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const reportedChainId = await publicClient.getChainId();
  if (reportedChainId !== CHAIN_ID) {
    throw new Error(
      `RPC chain id mismatch: expected ${CHAIN_ID}, endpoint reports ${reportedChainId}.`,
    );
  }
  if (!ALLOWED_CHAIN_IDS.has(reportedChainId)) {
    throw new Error(`RPC reports chain id ${reportedChainId}, which is not an allowed testnet.`);
  }

  // Reuse the SDK's client purely for chain metadata and the factory address.
  const beacon = createBeaconClient({
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID === 31337 ? 11155111 : CHAIN_ID,
  });
  const factoryAddress = beacon.factoryAddress;

  const head = await publicClient.getBlockNumber();
  const startBlock = head + BigInt(START_DELAY_BLOCKS);
  const endBlock = startBlock + BigInt(DURATION_BLOCKS);
  const claimBlock = endBlock;

  const steps = buildAuctionSteps(DURATION_BLOCKS);

  log(`rpc            ${new URL(RPC_URL).host}`);
  log(`chain          ${reportedChainId}`);
  log(`factory        ${factoryAddress}`);
  log(`head block     ${head}`);
  log("");
  log(`token          ${TOKEN_NAME} (${TOKEN_SYMBOL}), supply ${TOTAL_SUPPLY}`);
  log(`currency       native ETH`);
  log(`auction window ${startBlock} -> ${endBlock} (${DURATION_BLOCKS} blocks, ~${((DURATION_BLOCKS * 12) / 3600).toFixed(1)}h)`);
  log(`claim block    ${claimBlock}`);
  log(`floor price    ${FLOOR_PRICE} (${formatQ96(FLOOR_PRICE)})`);
  log(`tick spacing   ${TICK_SPACING}`);
  log(`graduates at   ${REQUIRED_RAISED} wei raised`);
  log(`schedule       ${steps.length} step(s), ${totalMps(steps)} mps over ${totalBlocks(steps)} blocks`);
  log("");

  // Validates every constructor rule before any gas is spent.
  const configData = encodeAuctionParameters({
    currency: "0x0000000000000000000000000000000000000000",
    tokensRecipient: "0x0000000000000000000000000000000000000001", // ActionConstants.MSG_SENDER
    fundsRecipient: "0x0000000000000000000000000000000000000001",
    startBlock,
    endBlock,
    claimBlock,
    tickSpacing: TICK_SPACING,
    validationHook: "0x0000000000000000000000000000000000000000",
    floorPriceQ96: FLOOR_PRICE,
    requiredCurrencyRaised: REQUIRED_RAISED,
    auctionStepsData: packAuctionSteps(steps),
  });
  log(`configData validated: ${(configData.length - 2) / 2} bytes`);

  if (DRY_RUN) {
    log("");
    log("DRY RUN - parameters validated, nothing deployed.");
    log("Set DEPLOYER_PRIVATE_KEY (or AGENT_PRIVATE_KEY) and re-run without --dry-run.");
    return;
  }

  // --- signer ------------------------------------------------------------
  // Accepts the key with or without the 0x prefix; never logged either way.
  const account = privateKeyToAccount(
    normalizePrivateKey(
      process.env.DEPLOYER_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY,
      "DEPLOYER_PRIVATE_KEY",
    ),
  );
  const wallet = createWalletClient({ account, chain: beacon.chain, transport: http(RPC_URL) });

  const balance = await publicClient.getBalance({ address: account.address });
  log(`deployer       ${account.address}`);
  log(`balance        ${balance} wei`);
  if (balance === 0n) {
    throw new Error(`${account.address} has no balance on chain ${reportedChainId}. Fund it first.`);
  }
  log("");

  // --- 1. deploy the demo token -------------------------------------------
  log("1/4 deploying demo ERC-20...");
  const tokenHash = await wallet.deployContract({
    abi: demoTokenAbi,
    bytecode: demoTokenBytecode as Hex,
    account,
    chain: beacon.chain,
    args: [TOKEN_NAME, TOKEN_SYMBOL, TOTAL_SUPPLY],
  });
  const tokenReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenHash });
  const token = tokenReceipt.contractAddress as Address;
  log(`    token ${token}`);

  // --- 2. create the auction ----------------------------------------------
  log("2/4 calling factory.initializeDistribution...");
  const salt = `0x${Date.now().toString(16).padStart(64, "0")}` as Hex;
  const createHash = await wallet.writeContract({
    address: factoryAddress,
    abi: factoryAbi,
    functionName: "initializeDistribution",
    args: [token, TOTAL_SUPPLY, configData, salt],
    account,
    chain: beacon.chain,
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

  let auction: Address | undefined;
  for (const entry of createReceipt.logs) {
    if (entry.address.toLowerCase() !== factoryAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [auctionCreatedEvent],
        topics: entry.topics,
        data: entry.data,
      });
      auction = decoded.args.auction as Address;
    } catch {
      // Not the event we are after.
    }
  }
  if (!auction) throw new Error("initializeDistribution succeeded but emitted no AuctionCreated.");
  log(`    auction ${auction}`);

  // --- 3. fund the auction with the token supply --------------------------
  log("3/4 transferring the token supply to the auction...");
  const transferHash = await wallet.writeContract({
    address: token,
    abi: demoTokenAbi,
    functionName: "transfer",
    args: [auction, TOTAL_SUPPLY],
    account,
    chain: beacon.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: transferHash });

  // --- 4. acknowledge receipt ---------------------------------------------
  // Without this the auction rejects every bid, even though it exists and looks
  // configured. It is the least obvious step in the whole flow.
  log("4/4 calling auction.onTokensReceived...");
  const ackHash = await wallet.writeContract({
    address: auction,
    abi: auctionAbi,
    functionName: "onTokensReceived",
    account,
    chain: beacon.chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: ackHash });

  const explorer = beacon.chain.blockExplorers?.default?.url;
  log("");
  log("=".repeat(66));
  log("Demo auction live");
  log("=".repeat(66));
  log(`token    ${token}`);
  log(`auction  ${auction}`);
  if (explorer) log(`explorer ${explorer}/address/${auction}`);
  log(`opens    block ${startBlock} (head is ${await publicClient.getBlockNumber()})`);
  log(`closes   block ${endBlock}`);
  log("");
  log("Next steps:");
  log(`  pnpm sync:auctions                      # index it into the directory`);
  log(`  AGENT_AUCTION_ADDRESS=${auction}  # point the agent at it`);
  log(`  /watch ${auction}                        # follow it in Telegram`);
}

main().catch((error) => {
  console.error(`\nDeployment failed:\n  ${(error as Error).message}\n`);
  process.exitCode = 1;
});
