import { defineConfig } from "tsup";

export default defineConfig([
  // React consumers: ESM + CJS.
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    // The SDK is a declared dependency, so load it from node_modules rather
    // than bundling a second copy. Its types are imported by our .d.ts anyway.
    external: ["react", "react-dom", "viem", "wagmi", "@hammerock/cca-sdk"],
    // The component uses hooks. Without this directive a Next.js App Router
    // user importing it into a server component gets a hooks error.
    banner: { js: '"use client";' },
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
