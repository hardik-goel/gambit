import { describe, it } from "vitest";
import { STORE_CONTRACT } from "./testkit/storeContract";
import { MemoryRoomStore } from "./stores/memory";

/**
 * The in-process store, held to the same contract the production one is.
 * See `apps/web/lib/server/supabase.test.ts` for the other half.
 */
describe("the memory store", () => {
  for (const example of STORE_CONTRACT) {
    it(example.name, async () => {
      await example.run(new MemoryRoomStore());
    });
  }
});
