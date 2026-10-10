import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import process from "node:process";
import console from "node:console";

const supported = new Set([
  "ethereum",
  "base",
  "unichain",
  "arbitrum",
  "sepolia",
  "base-sepolia",
  "unichain-sepolia",
]);
export function parseChains(raw = "ethereum,base,unichain,arbitrum,sepolia") {
  const chains = [...new Set(raw.split(",").map((chain) => chain.trim()))];
  if (chains.some((chain) => !supported.has(chain)))
    throw new Error("SYNC_CHAINS contains an unsupported chain slug.");
  return chains;
}

function execute(chain) {
  // Ubuntu's timeout kills the pnpm process group, including the SDK child.
  // Inputs remain separate arguments and never become shell code.
  return spawnSync(
    "timeout",
    [
      "--kill-after=10s",
      "240s",
      "pnpm",
      "--filter",
      "@hammerock/cca-sdk",
      "exec",
      "tsx",
      "../../.github/scripts/sync-chain.ts",
      chain,
    ],
    {
      env: process.env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

export async function syncChains(
  chains,
  { run = execute, wait = () => sleep(15_000), logger = console } = {},
) {
  const results = [];
  for (const chain of chains) {
    let successful = false;
    let attempts = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      logger.log(`::group::${chain} — attempt ${attempt}/2`);
      const result = run(chain);
      if (result.stdout) logger.log(result.stdout);
      if (result.stderr) logger.error(result.stderr);
      const incomplete = /enriched \d+, already complete \d+, failed [1-9]\d*/.test(
        result.stdout || "",
      );
      successful = result.status === 0 && !result.error && !incomplete;
      if (result.error)
        logger.error(`Sync process failed: ${result.error.code || "unknown error"}`);
      if (incomplete)
        logger.error("Some discovered auctions are missing metadata; retrying enrichment.");
      logger.log("::endgroup::");
      if (successful) break;
      if (attempt < 2) await wait();
    }
    results.push({ chain, successful, attempts });
    if (!successful) {
      logger.error(
        `::error title=${chain} sync failed::Check BEACON_RPC_URL, BEACON_LOGS_RPC_URL and BEACON_FALLBACK_RPC_URL secrets for this chain. Successful chains will still be committed.`,
      );
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = await syncChains(parseChains(process.env.SYNC_CHAINS || undefined));
  const summary = [
    "## Auction catalogue sync",
    "",
    "| Network | Result | Attempts |",
    "| --- | --- | --- |",
    ...results.map(
      ({ chain, successful, attempts }) =>
        `| ${chain} | ${successful ? "Complete" : "Incomplete — retry required"} | ${attempts} |`,
    ),
  ];
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
  if (results.some((result) => !result.successful)) process.exitCode = 1;
}
