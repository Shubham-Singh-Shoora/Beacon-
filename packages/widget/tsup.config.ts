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
    outExtension: () => ({ js: ".global.js" }),
    sourcemap: true,
    noExternal: [/.*/],
  },
]);
