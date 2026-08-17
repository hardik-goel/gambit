import { describe, expect, it } from "vitest";
import { deps, store } from "./table";

/**
 * There is one store, and everything uses it.
 *
 * This exists because for a while there were two: the routes imported an
 * in-process store while the engine was handed the Supabase one. On a single
 * long-lived process that was survivable — both were in the same memory. On
 * serverless it meant a room was written to Postgres and then looked for in a
 * Map that belonged to a different invocation and was always empty, so every
 * invite link and every scanned code answered "no table with that code" while
 * the row sat in the database.
 *
 * Nothing in the suite caught it, because in the test environment the two
 * happened to be the same object. Identity is the thing to assert, not
 * behaviour.
 */
describe("the server's store", () => {
  it("is the same one the engine writes through", () => {
    expect(store).toBe(deps.store);
  });
});
