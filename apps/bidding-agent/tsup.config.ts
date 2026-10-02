import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: false,
  // Runs as `cca-agent` / `npx @hammerock/cca-agent`.
  banner: { js: "#!/usr/bin/env node" },
});
