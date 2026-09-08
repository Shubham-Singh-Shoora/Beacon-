import { defineConfig } from "tsup";

export default defineConfig([
  // React consumers: ESM + CJS, SDK bundled in so it installs standalone.
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react", "react-dom", "viem", "wagmi"],
    noExternal: ["@beacon/cca-sdk"],
  },
  // Non-React sites: single <script> tag that mounts into a div.
  {
    entry: { mount: "src/mount.ts" },
    format: ["iife"],
    globalName: "BeaconCCA",
    // A plain HTML page has no `process`, but React (and viem) reference
    // `process.env.NODE_ENV`. Substitute it at build time, otherwise the
    // bundle throws "process is not defined" before it can mount.
    platform: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    // Bundles React + the SDK for host pages that ship no build step, so size
    // matters more here than in the ESM/CJS builds.
    minify: true,
    outExtension: () => ({ js: ".global.js" }),
    sourcemap: false,
    noExternal: [/.*/],
  },
]);
