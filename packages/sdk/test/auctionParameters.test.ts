import { describe, expect, it } from "vitest";
import {
  AuctionParametersError,
  buildAuctionSteps,
  decodeAuctionParameters,
  encodeAuctionParameters,
  MIN_FLOOR_PRICE,
  packAuctionSteps,
  totalBlocks,
  totalMps,
  unpackAuctionSteps,
} from "../src/auctionParameters";
import type { AuctionParameters } from "../src/auctionParameters";
import { MPS } from "../src/q96";
import fixture from "./fixtures/auction-config.json";

/**
 * REAL configData from Sepolia auction 0x145A9163d5a89fe843955b1D337F75d46088E156,
 * captured from the factory's AuctionCreated event. Decoding this correctly is
 * the strongest available check that the tuple layout matches the contract.
 */
const REAL_CONFIG_DATA = fixture.configData as `0x${string}`;

const base: AuctionParameters = {
  currency: "0x0000000000000000000000000000000000000000",
  tokensRecipient: "0x18d058a7E0486E632f7DfC473BC76D72CD201cAd",
  fundsRecipient: "0x18d058a7E0486E632f7DfC473BC76D72CD201cAd",
  startBlock: 1000n,
  endBlock: 1025n,
  claimBlock: 1026n,
  tickSpacing: 100_000n,
  validationHook: "0x0000000000000000000000000000000000000000",
  floorPriceQ96: 4_295_000_000n,
  requiredCurrencyRaised: 0n,
  auctionStepsData: packAuctionSteps([{ mps: 400_000, blockDelta: 25 }]),
};

describe("decoding real on-chain configData", () => {
  it("decodes an auction that actually deployed", () => {
    const params = decodeAuctionParameters(REAL_CONFIG_DATA);

    // Cross-checked against the auction's own view functions.
    expect(params.startBlock).toBe(11166195n);
    expect(params.endBlock).toBe(11166220n);
    expect(params.claimBlock).toBe(11166221n);
    expect(params.tickSpacing).toBe(100_000n);
    expect(params.floorPriceQ96).toBe(4_295_000_000n);
    expect(params.currency).toBe("0x0000000000000000000000000000000000000000");
    expect(params.requiredCurrencyRaised).toBe(0n);
  });

  it("re-encodes to byte-identical configData", () => {
    const params = decodeAuctionParameters(REAL_CONFIG_DATA);
    expect(encodeAuctionParameters(params).toLowerCase()).toBe(REAL_CONFIG_DATA.toLowerCase());
  });

  it("unpacks its supply schedule to exactly MPS", () => {
    const params = decodeAuctionParameters(REAL_CONFIG_DATA);
    const steps = unpackAuctionSteps(params.auctionStepsData);
    expect(steps).toEqual([{ mps: 400_000, blockDelta: 25 }]);
    expect(totalMps(steps)).toBe(MPS);
    expect(params.startBlock + totalBlocks(steps)).toBe(params.endBlock);
  });
});

describe("packAuctionSteps / unpackAuctionSteps", () => {
  it("round-trips", () => {
    const steps = [
      { mps: 400_000, blockDelta: 25 },
      { mps: 1, blockDelta: 7 },
    ];
    expect(unpackAuctionSteps(packAuctionSteps(steps))).toEqual(steps);
  });

  it("emits 8 bytes per step", () => {
    expect(packAuctionSteps([{ mps: 1, blockDelta: 1 }])).toHaveLength(2 + 16);
    expect(packAuctionSteps([{ mps: 1, blockDelta: 1 }, { mps: 2, blockDelta: 2 }])).toHaveLength(
      2 + 32,
    );
  });

  it("refuses a zero blockDelta, which the contract rejects", () => {
    expect(() => packAuctionSteps([{ mps: 1, blockDelta: 0 }])).toThrow(AuctionParametersError);
  });

  it("refuses values that overflow their packed width", () => {
    expect(() => packAuctionSteps([{ mps: 16_777_216, blockDelta: 1 }])).toThrow(/uint24/);
    expect(() => packAuctionSteps([])).toThrow(/empty/);
  });
});

describe("buildAuctionSteps", () => {
  it("releases exactly MPS for a duration that divides evenly", () => {
    const steps = buildAuctionSteps(25);
    expect(totalMps(steps)).toBe(MPS);
    expect(totalBlocks(steps)).toBe(25n);
  });

  it("puts the remainder on the final block when MPS does not divide evenly", () => {
    // 1e7 / 3 is not an integer; a naive schedule would revert.
    const steps = buildAuctionSteps(3);
    expect(totalMps(steps)).toBe(MPS);
    expect(totalBlocks(steps)).toBe(3n);
  });

  it("always sums to exactly MPS across many awkward durations", () => {
    for (const duration of [2, 3, 7, 13, 99, 137, 300, 999, 2001, 43_200]) {
      const steps = buildAuctionSteps(duration);
      expect(totalMps(steps)).toBe(MPS);
      expect(totalBlocks(steps)).toBe(BigInt(duration));
    }
  });

  it("rejects a duration too long to release any supply per block", () => {
    expect(() => buildAuctionSteps(20_000_000)).toThrow(AuctionParametersError);
  });
});

describe("validateAuctionParameters (via encode)", () => {
  it("accepts well-formed parameters", () => {
    expect(() => encodeAuctionParameters(base)).not.toThrow();
  });

  it("rejects endBlock at or before startBlock", () => {
    expect(() => encodeAuctionParameters({ ...base, endBlock: base.startBlock })).toThrow(
      /InvalidEndBlock/,
    );
  });

  it("rejects a claimBlock before endBlock", () => {
    expect(() => encodeAuctionParameters({ ...base, claimBlock: base.endBlock - 1n })).toThrow(
      /ClaimBlockIsBeforeEndBlock/,
    );
  });

  it("rejects a floor price below the protocol minimum", () => {
    expect(() =>
      encodeAuctionParameters({ ...base, floorPriceQ96: MIN_FLOOR_PRICE - 100_000n }),
    ).toThrow(/FloorPriceTooLow/);
    expect(() => encodeAuctionParameters({ ...base, floorPriceQ96: 0n })).toThrow(
      /FloorPriceIsZero/,
    );
  });

  it("rejects a floor price off the tick boundary", () => {
    expect(() => encodeAuctionParameters({ ...base, floorPriceQ96: 4_295_000_001n })).toThrow(
      /TickPriceNotAtBoundary/,
    );
  });

  it("rejects a tick spacing below the minimum", () => {
    expect(() => encodeAuctionParameters({ ...base, tickSpacing: 1n })).toThrow(
      /TickSpacingTooSmall/,
    );
  });

  it("rejects a schedule that does not release exactly MPS", () => {
    expect(() =>
      encodeAuctionParameters({
        ...base,
        auctionStepsData: packAuctionSteps([{ mps: 1, blockDelta: 25 }]),
      }),
    ).toThrow(/InvalidStepDataMps/);
  });

  it("rejects a schedule whose blocks do not land on endBlock", () => {
    expect(() =>
      encodeAuctionParameters({
        ...base,
        auctionStepsData: packAuctionSteps([{ mps: 200_000, blockDelta: 50 }]),
      }),
    ).toThrow(/InvalidEndBlockGivenStepData/);
  });
});
