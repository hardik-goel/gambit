import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const r = (p: string) => resolve(process.cwd(), p);

export default defineConfig({
  resolve: {
    alias: {
      "@gambit/sdk/testkit": r("packages/sdk/src/testkit/index.ts"),
      "@gambit/sdk": r("packages/sdk/src/index.ts"),
      "@gambit/core": r("packages/core/src/index.ts"),
      "@gambit/ui": r("packages/ui/src/index.ts"),
      "@gambit/game-chess": r("packages/games/chess/src/index.ts"),
      "@gambit/game-boxcar": r("packages/games/boxcar/src/index.ts"),
      "@gambit/game-quintet": r("packages/games/quintet/src/index.ts"),
      "@gambit/game-mosaic": r("packages/games/mosaic/src/index.ts"),
      "@gambit/game-facet": r("packages/games/facet/src/index.ts"),
      "@gambit/game-hamlet": r("packages/games/hamlet/src/index.ts"),
      "@gambit/game-stronghold": r("packages/games/stronghold/src/index.ts"),
      "@gambit/game-phantom": r("packages/games/phantom/src/index.ts"),
      "@gambit/game-motive": r("packages/games/motive/src/index.ts"),
      "@gambit/game-landfall": r("packages/games/landfall/src/index.ts"),
      "@gambit/game-remedy": r("packages/games/remedy/src/index.ts"),
      "@gambit/games": r("packages/games/registry/src/index.ts")
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000
  }
});
