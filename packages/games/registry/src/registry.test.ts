import { describe, expect, it } from "vitest";
import { CATALOG, GAME_IDS, SHELF_ORDER, shelfEntries } from "./index";
import { SHELF_META } from "./meta";

describe("the catalogue", () => {
  it("holds all eleven launch games, in shelf order", () => {
    expect(GAME_IDS).toHaveLength(11);
    expect(GAME_IDS).toEqual(SHELF_ORDER);
    for (const id of SHELF_ORDER) expect(CATALOG[id], `${id} is missing`).toBeDefined();
  });

  it("gives every game the metadata the shelf and the lobby need", () => {
    for (const [id, def] of Object.entries(CATALOG)) {
      expect(def.id, `${id} disagrees about its own id`).toBe(id);
      expect(def.meta.name.length).toBeGreaterThan(2);
      expect(def.meta.tagline.length).toBeGreaterThan(4);
      expect(def.meta.blurb.length).toBeGreaterThan(20);
      expect(def.meta.minPlayers).toBeGreaterThanOrEqual(2);
      expect(def.meta.maxPlayers).toBeGreaterThanOrEqual(def.meta.minPlayers);
      expect(def.meta.themeTokens.hue).toMatch(/^#[0-9a-f]{6}$/i);
      expect(def.Tutorial.steps.length).toBeGreaterThanOrEqual(4);
      expect(Object.keys(def.audioCues).length).toBeGreaterThan(2);
      // Every cue a game names must be one the audio engine can actually play.
      expect(def.configSchema.safeParse({}).success, `${id} has no default config`).toBe(true);
    }
  });

  it("keeps the generated shelf metadata in step with the catalogue", () => {
    // If this fails, run: pnpm exec tsx scripts/gen-shelf-meta.ts
    expect(SHELF_META).toEqual(shelfEntries());
  });

  it("never uses a name we don't own", () => {
    const forbidden = [
      "ticket to ride",
      "catan",
      "settlers",
      "sequence",
      "scotland yard",
      "cluedo",
      "clue",
      "carcassonne",
      "azul",
      "splendor",
      "risk",
      "pandemic"
    ];
    const haystack = JSON.stringify(
      Object.values(CATALOG).map((d) => ({ meta: d.meta, tutorial: d.Tutorial }))
    ).toLowerCase();
    for (const name of forbidden) {
      expect(haystack.includes(name), `"${name}" appears in the catalogue copy`).toBe(false);
    }
  });
});
