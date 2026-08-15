import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source: Next compiles them with the app,
  // which is also what keeps the engine isomorphic — the exact same module runs
  // in the route handler and in the browser.
  transpilePackages: ["@gambit/core", "@gambit/sdk", "@gambit/ui", "@gambit/games", "@gambit/game-chess"],
  experimental: {
    optimizePackageImports: ["framer-motion"]
  }
};

export default config;
