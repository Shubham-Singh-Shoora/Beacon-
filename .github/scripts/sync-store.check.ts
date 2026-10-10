import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AtomicStore } from "./sync-chain";

test("a failed sync write preserves the previous catalogue and removes temporary files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "beacon-sync-test-"));
  const file = join(directory, "auctions.base.json");
  const factoryAddress = "0x000000001F26a0044BaA66024e7b6599c61963F8" as const;
  const update = {
    chainId: 8453,
    factoryAddress,
    factoryAddresses: [factoryAddress],
    lastSyncedBlock: 10n,
    auctions: [],
  };
  try {
    const store = new AtomicStore(file);
    await store.merge(update);
    const before = await readFile(file, "utf8");
    await assert.rejects(
      store.merge({ ...update, chainId: 1, lastSyncedBlock: 20n }),
      /refusing to merge/,
    );
    assert.equal(await readFile(file, "utf8"), before);
    assert.deepEqual(await readdir(directory), ["auctions.base.json"]);
    await store.merge({ ...update, lastSyncedBlock: 11n });
    assert.equal((await store.read())?.lastSyncedBlock, 11n);
    assert.deepEqual(await readdir(directory), ["auctions.base.json"]);
  } finally {
    assert.equal(dirname(directory), tmpdir());
    await rm(directory, { recursive: true, force: true });
  }
});
