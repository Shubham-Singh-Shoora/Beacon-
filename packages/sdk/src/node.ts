/**
 * Node-only entry point: the auction store and the sync/enrichment routines.
 *
 * Kept out of the main entry point because these import `node:fs` and
 * `node:path`, which cannot be bundled for the browser. Server Components,
 * route handlers, CLIs and the bot import from here; the widget never does.
 */
export * from "./enrich";
export * from "./store";
export * from "./sync";
