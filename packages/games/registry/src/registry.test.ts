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

  it("uses a name we don't own in one field, and nowhere else", () => {
    // Another publisher's title is allowed in exactly one place — `familiar`,
    // which exists to say "our take on Ticket to Ride" and is attributed
    // wherever it is shown. It must not leak into a game's own name, its
    // tagline, its kind, its blurb, its badges or its tutorial script, because
    // those are the places where using somebody else's name stops being a
    // description and starts being a claim. See LEGAL.md.
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
      Object.values(CATALOG).map((d) => {
        const { familiar: _familiar, ...rest } = d.meta;
        return { meta: rest, tutorial: d.Tutorial };
      })
    ).toLowerCase();
    for (const name of forbidden) {
      expect(haystack.includes(name), `"${name}" appears in the catalogue copy`).toBe(false);
    }

    // And the one field that may carry a title carries its owner with it, so
    // that anywhere it is rendered is able to attribute it.
    for (const def of Object.values(CATALOG)) {
      const familiar = def.meta.familiar;
      if (!familiar) continue;
      expect(familiar.title.length, `${def.meta.name} has an empty familiar title`).toBeGreaterThan(0);
      const isPublicDomain = familiar.title.toLowerCase() === def.meta.name.toLowerCase();
      expect(
        isPublicDomain || Boolean(familiar.publisher),
        `${def.meta.name} names "${familiar.title}" without saying whose it is`
      ).toBe(true);
    }
  });
});
