import { describe, it } from "vitest";
import { STORE_CONTRACT } from "@gambit/core/testkit";
import { SupabaseRoomStore, hasSupabase } from "./supabase";

/**
 * The production store, held to exactly the contract the in-process one is.
 *
 * Without a project configured this skips rather than passes quietly — a green
 * tick here has to mean the queries ran. To run it:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm test
 *
 * The schema itself is verified separately, and without any project at all, by
 * `pnpm db:check`, which applies the migrations to a real Postgres and
 * exercises the atomic append.
 */
const configured = hasSupabase();

describe.skipIf(!configured)("the Supabase store", () => {
  for (const example of STORE_CONTRACT) {
    it(example.name, async () => {
      await example.run(new SupabaseRoomStore());
    });
  }
});

describe.runIf(!configured)("the Supabase store (not configured)", () => {
  it("is skipped, loudly, rather than passing on nothing", () => {
    console.info(
      "[gambit] Supabase contract tests skipped — set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY to run them. `pnpm db:check` verifies the schema meanwhile."
    );
  });
});
