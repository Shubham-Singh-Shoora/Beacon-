/**
 * Encoding and validating `AuctionParameters`, the blob the factory takes as
 * `configData`.
 *
 * Every rule enforced here is transcribed from the v1.1.0 constructors
 * (`StepStorage`, `TickStorage`, `ContinuousClearingAuction`) rather than
 * guessed, and each check names the revert it prevents. Getting any of them
 * wrong means a deployment that reverts after you have already spent gas
 * minting and transferring a token supply.
 */
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import type { Address, Hex } from "viem";
import { MPS } from "./q96";

/** Mirrors `struct AuctionParameters`. */
export interface AuctionParameters {
  /** Currency to raise in. `address(0)` for native ETH. */
  currency: Address;
  /** Receives leftover unsold tokens. */
  tokensRecipient: Address;
  /** Receives the raised funds. */
  fundsRecipient: Address;
  startBlock: bigint;
  endBlock: bigint;
  /** Block from which bidders can claim. Must be >= endBlock. */
  claimBlock: bigint;
  tickSpacing: bigint;
  /** Optional pre-bid hook. `address(0)` for none. */
  validationHook: Address;
  /** Q96-encoded starting price. */
  floorPriceQ96: bigint;
  /** Currency that must be raised for the auction to graduate. */
  requiredCurrencyRaised: bigint;
  /** Packed supply schedule. Build with {@link buildAuctionSteps}. */
  auctionStepsData: Hex;
}

/** One entry of the supply schedule. */
export interface AuctionStep {
  /** Milli-bips of supply released per block during this step. uint24. */
  mps: number;
  /** How many blocks this step lasts. uint40, must be > 0. */
  blockDelta: number;
}

/** `ConstantsLib.MIN_FLOOR_PRICE` - `type(uint32).max + 1`. */
export const MIN_FLOOR_PRICE = 4_294_967_296n;
/** `ConstantsLib.MIN_TICK_SPACING`. */
export const MIN_TICK_SPACING = 2n;

const UINT24_MAX = 16_777_215;
const UINT40_MAX = 1_099_511_627_775;

export class AuctionParametersError extends Error {}

/**
 * Pack steps into `auctionStepsData`.
 *
 * Each step is one 8-byte word: `uint24 mps | uint40 blockDelta`.
 */
export function packAuctionSteps(steps: readonly AuctionStep[]): Hex {
  if (steps.length === 0) {
    throw new AuctionParametersError("auctionStepsData cannot be empty (InvalidAuctionDataLength).");
  }

  let packed = "";
  for (const step of steps) {
    if (!Number.isInteger(step.mps) || step.mps < 0 || step.mps > UINT24_MAX) {
      throw new AuctionParametersError(`step mps ${step.mps} does not fit uint24.`);
    }
    if (!Number.isInteger(step.blockDelta) || step.blockDelta <= 0) {
      // StepBlockDeltaCannotBeZero()
      throw new AuctionParametersError(`step blockDelta must be > 0, got ${step.blockDelta}.`);
    }
    if (step.blockDelta > UINT40_MAX) {
      throw new AuctionParametersError(`step blockDelta ${step.blockDelta} does not fit uint40.`);
    }
    packed += step.mps.toString(16).padStart(6, "0");
    packed += step.blockDelta.toString(16).padStart(10, "0");
  }

  return `0x${packed}`;
}

/** Unpack `auctionStepsData` back into steps. */
export function unpackAuctionSteps(data: Hex): AuctionStep[] {
  const body = data.slice(2);
  if (body.length === 0 || body.length % 16 !== 0) {
    throw new AuctionParametersError(
      `auctionStepsData must be a whole number of 8-byte steps, got ${body.length / 2} bytes.`,
    );
  }

  const steps: AuctionStep[] = [];
  for (let i = 0; i < body.length; i += 16) {
    steps.push({
      mps: Number.parseInt(body.slice(i, i + 6), 16),
      blockDelta: Number.parseInt(body.slice(i + 6, i + 16), 16),
    });
  }
  return steps;
}

/**
 * Build a schedule that releases the whole supply evenly over `durationBlocks`.
 *
 * The contract requires `sum(mps * blockDelta) == MPS` exactly. `MPS` (1e7)
 * rarely divides evenly by a duration, so this emits a flat step for all but
 * the last block and puts the remainder on the final block, rather than
 * silently rounding and reverting with `InvalidStepDataMps`.
 */
export function buildAuctionSteps(durationBlocks: number): AuctionStep[] {
  if (!Number.isInteger(durationBlocks) || durationBlocks < 2) {
    throw new AuctionParametersError(`durationBlocks must be an integer >= 2, got ${durationBlocks}.`);
  }

  const total = Number(MPS);
  const perBlock = Math.floor(total / durationBlocks);
  if (perBlock <= 0) {
    throw new AuctionParametersError(
      `durationBlocks ${durationBlocks} is longer than MPS (${total}) allows - each block would release 0.`,
    );
  }

  const remainder = total - perBlock * durationBlocks;
  const finalBlockMps = perBlock + remainder;

  if (finalBlockMps > UINT24_MAX) {
    throw new AuctionParametersError(`final step mps ${finalBlockMps} does not fit uint24.`);
  }

  return durationBlocks === 1
    ? [{ mps: total, blockDelta: 1 }]
    : [
        { mps: perBlock, blockDelta: durationBlocks - 1 },
        { mps: finalBlockMps, blockDelta: 1 },
      ];
}

/** Total supply released by a schedule, which must equal `MPS`. */
export function totalMps(steps: readonly AuctionStep[]): bigint {
  return steps.reduce((sum, step) => sum + BigInt(step.mps) * BigInt(step.blockDelta), 0n);
}

/** Total blocks a schedule spans. */
export function totalBlocks(steps: readonly AuctionStep[]): bigint {
  return steps.reduce((sum, step) => sum + BigInt(step.blockDelta), 0n);
}

/**
 * Validate parameters against every constructor rule, before spending gas.
 * Throws on the first violation, naming the revert it would have caused.
 */
export function validateAuctionParameters(params: AuctionParameters): void {
  // StepStorage: InvalidEndBlock()
  if (params.startBlock >= params.endBlock) {
    throw new AuctionParametersError(
      `startBlock (${params.startBlock}) must be < endBlock (${params.endBlock}) - InvalidEndBlock.`,
    );
  }

  // ContinuousClearingAuction: ClaimBlockIsBeforeEndBlock()
  if (params.claimBlock < params.endBlock) {
    throw new AuctionParametersError(
      `claimBlock (${params.claimBlock}) must be >= endBlock (${params.endBlock}) - ClaimBlockIsBeforeEndBlock.`,
    );
  }

  // TickStorage: TickSpacingTooSmall()
  if (params.tickSpacing < MIN_TICK_SPACING) {
    throw new AuctionParametersError(
      `tickSpacing (${params.tickSpacing}) must be >= ${MIN_TICK_SPACING} - TickSpacingTooSmall.`,
    );
  }

  // TickStorage: FloorPriceIsZero() / FloorPriceTooLow()
  if (params.floorPriceQ96 === 0n) {
    throw new AuctionParametersError("floorPrice cannot be zero - FloorPriceIsZero.");
  }
  if (params.floorPriceQ96 < MIN_FLOOR_PRICE) {
    throw new AuctionParametersError(
      `floorPrice (${params.floorPriceQ96}) must be >= ${MIN_FLOOR_PRICE} - FloorPriceTooLow.`,
    );
  }

  // TickStorage._getTick: TickPriceNotAtBoundary()
  if (params.floorPriceQ96 % params.tickSpacing !== 0n) {
    throw new AuctionParametersError(
      `floorPrice (${params.floorPriceQ96}) must be a multiple of tickSpacing (${params.tickSpacing}) - TickPriceNotAtBoundary.`,
    );
  }

  // StepStorage._validate
  const steps = unpackAuctionSteps(params.auctionStepsData);
  const mpsSum = totalMps(steps);
  if (mpsSum !== MPS) {
    throw new AuctionParametersError(
      `supply schedule releases ${mpsSum} mps, must be exactly ${MPS} - InvalidStepDataMps.`,
    );
  }

  const blockSum = totalBlocks(steps);
  if (params.startBlock + blockSum !== params.endBlock) {
    throw new AuctionParametersError(
      `supply schedule spans ${blockSum} blocks, so it ends at ${params.startBlock + blockSum}, ` +
        `but endBlock is ${params.endBlock} - InvalidEndBlockGivenStepData.`,
    );
  }
}

/** ABI tuple matching `AuctionParameters`, in declaration order. */
const PARAMETERS_TUPLE = parseAbiParameters(
  "(address currency, address tokensRecipient, address fundsRecipient, uint64 startBlock, uint64 endBlock, uint64 claimBlock, uint256 tickSpacing, address validationHook, uint256 floorPrice, uint128 requiredCurrencyRaised, bytes auctionStepsData)",
);

/**
 * ABI-encode parameters into the factory's `configData`.
 * Validates first - the factory decodes this blindly and the auction's
 * constructor is where a bad value surfaces, after the gas is spent.
 */
export function encodeAuctionParameters(params: AuctionParameters): Hex {
  validateAuctionParameters(params);

  return encodeAbiParameters(PARAMETERS_TUPLE, [
    {
      currency: params.currency,
      tokensRecipient: params.tokensRecipient,
      fundsRecipient: params.fundsRecipient,
      startBlock: params.startBlock,
      endBlock: params.endBlock,
      claimBlock: params.claimBlock,
      tickSpacing: params.tickSpacing,
      validationHook: params.validationHook,
      floorPrice: params.floorPriceQ96,
      requiredCurrencyRaised: params.requiredCurrencyRaised,
      auctionStepsData: params.auctionStepsData,
    },
  ]);
}

/**
 * Decode a factory `AuctionCreated` event's `configData`.
 * Lets the directory show how any auction was configured.
 */
export function decodeAuctionParameters(configData: Hex): AuctionParameters {
  const [decoded] = decodeAbiParameters(PARAMETERS_TUPLE, configData);
  const value = decoded as unknown as {
    currency: Address;
    tokensRecipient: Address;
    fundsRecipient: Address;
    startBlock: bigint;
    endBlock: bigint;
    claimBlock: bigint;
    tickSpacing: bigint;
    validationHook: Address;
    floorPrice: bigint;
    requiredCurrencyRaised: bigint;
    auctionStepsData: Hex;
  };

  return {
    currency: value.currency,
    tokensRecipient: value.tokensRecipient,
    fundsRecipient: value.fundsRecipient,
    startBlock: BigInt(value.startBlock),
    endBlock: BigInt(value.endBlock),
    claimBlock: BigInt(value.claimBlock),
    tickSpacing: value.tickSpacing,
    validationHook: value.validationHook,
    floorPriceQ96: value.floorPrice,
    requiredCurrencyRaised: value.requiredCurrencyRaised,
    auctionStepsData: value.auctionStepsData,
  };
}
