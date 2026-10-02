import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Next only reads .env from its own directory. Beacon keeps a single .env at
// the monorepo root so the SDK, bot, agent and web app share one config, so
// load it here before the app starts.
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  // One committed store per chain (data/auctions.<slug>.json); the server reads them at request time.
  outputFileTracingIncludes: { "/*": ["../../data/auctions.*.json"] },
  // Workspace packages ship TypeScript source, not dist - Next compiles them.
  transpilePackages: ["@hammerock/cca-sdk", "@hammerock/cca-widget"],
};

export default nextConfig;
