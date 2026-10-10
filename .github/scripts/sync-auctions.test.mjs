import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChains, syncChains } from "./sync-auctions.mjs";

const logger = { log() {}, error() {} };
test("rejects malformed input before launching any command", () => {
  assert.throws(() => parseChains("base; echo unsafe"), /unsupported/);
  assert.throws(() => parseChains("base,"), /unsupported/);
  assert.deepEqual(parseChains(" base,ethereum,base "), ["base", "ethereum"]);
});
test("retries transient failures and continues when a network remains unavailable", async () => {
  const calls = [];
  let waits = 0;
  const results = await syncChains(["base", "ethereum", "unichain"], {
    logger,
    wait: async () => {
      waits++;
    },
    run(chain) {
      calls.push(chain);
      return {
        status:
          chain === "base" ||
          (chain === "ethereum" && calls.filter((c) => c === chain).length === 1)
            ? 1
            : 0,
      };
    },
  });
  assert.deepEqual(results, [
    { chain: "base", successful: false, attempts: 2 },
    { chain: "ethereum", successful: true, attempts: 2 },
    { chain: "unichain", successful: true, attempts: 1 },
  ]);
  assert.equal(waits, 2);
});
test("does not mark missing metadata or a timed-out process as successful", async () => {
  const results = await syncChains(["base", "ethereum"], {
    logger,
    wait: async () => {},
    run(chain) {
      return chain === "base"
        ? { status: 0, stdout: "enriched 3, already complete 10, failed 1, total 14" }
        : { status: 124 };
    },
  });
  assert.ok(results.every((result) => !result.successful && result.attempts === 2));
});
