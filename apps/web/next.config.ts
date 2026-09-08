import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not dist — Next compiles them.
  transpilePackages: ["@beacon/cca-sdk", "@beacon/cca-widget"],
};

export default nextConfig;
