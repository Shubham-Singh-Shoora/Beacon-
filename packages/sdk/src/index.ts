/**
 * @beacon/cca-sdk
 *
 * Shared core for Uniswap's Continuous Clearing Auction contracts. The
 * directory site, embeddable widget, Telegram bot and bidding agent are all
 * thin consumers of this package. Contract calls, ABIs, event decoding and Q96
 * math live here and nowhere else.
 *
 * This entry point is ISOMORPHIC - safe in a browser bundle. Anything that
 * touches the filesystem (the auction store, sync and enrichment) lives in
 * `@beacon/cca-sdk/node`, because importing it here would drag `node:fs` into
 * the widget's bundle and break any client-side build.
 */
export * from "./abis";
export * from "./auctionParameters";
export * from "./client";
export * from "./constants";
export * from "./discover";
export * from "./erc20";
export * from "./q96";
export * from "./read";
export * from "./types";
export * from "./write";
