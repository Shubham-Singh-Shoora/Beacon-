import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/beacon", () => ({
  listedNetworks: () => [{ slug: "base", chainId: 8453 }],
  resolveNetwork: () => ({ slug: "base", chainId: 8453 }),
  findAuctionNetwork: vi.fn(),
  getLiveState: vi.fn(),
}));
import { getLiveState } from "../lib/beacon";
import { GET } from "../app/api/auctions/[address]/route";
const address = "0x0000000000000000000000000000000000000001";
const request = (chain: string, auction = address) =>
  GET(new Request(`https://beacon.test/api/auctions/${auction}?chain=${chain}`), {
    params: Promise.resolve({ address: auction }),
  });

beforeEach(() => vi.clearAllMocks());
describe("auction state endpoint", () => {
  it("rejects bad addresses and networks before any RPC call", async () => {
    expect((await request("base", "invalid")).status).toBe(400);
    expect((await request("not-a-chain")).status).toBe(400);
    expect(getLiveState).not.toHaveBeenCalled();
  });
  it("shares successful public responses through the CDN", async () => {
    vi.mocked(getLiveState).mockResolvedValue({
      headBlock: 100n,
      state: {
        checkpoint: {
          clearingPriceQ96: 2n,
          cumulativeMps: 3,
          currencyRaisedAtClearingPriceQ96X7: 0n,
          cumulativeMpsPerPrice: 0n,
          prevBlock: 0n,
          nextBlock: 0n,
        },
        currencyRaised: 4n,
        totalCleared: 5n,
        isGraduated: true,
      },
    });
    const response = await request("base");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=10");
    expect(await response.json()).toMatchObject({
      chainId: 8453,
      headBlock: "100",
      totalCleared: "5",
    });
  });
  it("returns a retryable, uncached error without leaking RPC credentials", async () => {
    vi.mocked(getLiveState).mockRejectedValue(new Error("https://rpc.test/private-key"));
    const response = await request("base");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.text()).not.toContain("private-key");
  });
});
