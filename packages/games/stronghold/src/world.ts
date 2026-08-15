/**
 * Stronghold's world: forty-two territories in six regions.
 *
 * The map is original to Gambit — the names, the shapes of the regions and the
 * borders between them. What it shares with the genre is structure: a big
 * region that pays well and is impossible to hold, a small one that is cheap to
 * take and cheap to lose, and choke points worth arguing over.
 */

export interface Territory {
  key: string;
  name: string;
  region: string;
  /** Map coordinates, 0–1000 by 0–600. */
  x: number;
  y: number;
  borders: string[];
}

export interface Region {
  key: string;
  name: string;
  /** Armies per turn for holding every territory in it. */
  bonus: number;
  hue: string;
}

export const REGIONS: Region[] = [
  { key: "northreach", name: "Northreach", bonus: 5, hue: "#c98a4a" },
  { key: "sunder", name: "Sunder Coast", bonus: 2, hue: "#8a5ba6" },
  { key: "kingdoms", name: "Old Kingdoms", bonus: 5, hue: "#3c6ea8" },
  { key: "ashlands", name: "Ashlands", bonus: 3, hue: "#a6592e" },
  { key: "vastmark", name: "Vastmark", bonus: 7, hue: "#4d8a52" },
  { key: "coralia", name: "Coralia", bonus: 2, hue: "#3f8f8a" }
];

const t = (
  key: string,
  name: string,
  region: string,
  x: number,
  y: number,
  borders: string[]
): Territory => ({ key, name, region, x, y, borders });

export const TERRITORIES: Territory[] = [
  // ---- Northreach (9)
  t("frostgate", "Frostgate", "northreach", 70, 90, ["kelpbay", "snowmere", "greylund", "farhold"]),
  t("kelpbay", "Kelp Bay", "northreach", 60, 175, ["frostgate", "snowmere", "pinefall"]),
  t("snowmere", "Snowmere", "northreach", 150, 140, ["frostgate", "kelpbay", "pinefall", "ironmoor", "greylund"]),
  t("greylund", "Greylund", "northreach", 205, 65, ["frostgate", "snowmere", "ironmoor", "coldspire"]),
  t("ironmoor", "Ironmoor", "northreach", 215, 165, ["snowmere", "greylund", "coldspire", "pinefall", "tarnhollow"]),
  t("coldspire", "Coldspire", "northreach", 300, 80, ["greylund", "ironmoor", "tarnhollow", "highmarch"]),
  t("pinefall", "Pinefall", "northreach", 130, 235, ["kelpbay", "snowmere", "ironmoor", "tarnhollow"]),
  t("tarnhollow", "Tarn Hollow", "northreach", 230, 250, ["pinefall", "ironmoor", "coldspire", "sablereach"]),
  t("sablereach", "Sable Reach", "northreach", 195, 330, ["tarnhollow", "verdance"]),

  // ---- Sunder Coast (4)
  t("verdance", "Verdance", "sunder", 245, 405, ["sablereach", "palma", "cinderpoint"]),
  t("palma", "Palma", "sunder", 215, 470, ["verdance", "cinderpoint", "auralis"]),
  t("cinderpoint", "Cinderpoint", "sunder", 300, 460, ["verdance", "palma", "auralis", "sandreach"]),
  t("auralis", "Auralis", "sunder", 255, 545, ["palma", "cinderpoint"]),

  // ---- Old Kingdoms (7)
  t("highmarch", "Highmarch", "kingdoms", 390, 110, ["coldspire", "wexford", "norvik"]),
  t("norvik", "Norvik", "kingdoms", 470, 75, ["highmarch", "wexford", "estmere", "duskvale"]),
  t("wexford", "Wexford", "kingdoms", 400, 180, ["highmarch", "norvik", "estmere", "bellhaven"]),
  t("bellhaven", "Bellhaven", "kingdoms", 425, 250, ["wexford", "estmere", "cragspire", "sandreach"]),
  t("estmere", "Estmere", "kingdoms", 480, 175, ["wexford", "norvik", "bellhaven", "cragspire", "duskvale"]),
  t("cragspire", "Cragspire", "kingdoms", 500, 245, ["bellhaven", "estmere", "duskvale", "emberwold", "mirzah"]),
  t("duskvale", "Duskvale", "kingdoms", 560, 155, ["norvik", "estmere", "cragspire", "uraltar", "silkgate", "mirzah"]),

  // ---- Ashlands (6)
  t("sandreach", "Sandreach", "ashlands", 455, 340, ["cinderpoint", "bellhaven", "emberwold", "sunfall", "kalahar"]),
  t("emberwold", "Emberwold", "ashlands", 540, 330, ["sandreach", "sunfall", "cragspire", "mirzah"]),
  t("sunfall", "Sunfall", "ashlands", 555, 420, ["sandreach", "emberwold", "kalahar", "zephyr", "moonrock", "mirzah"]),
  t("kalahar", "Kalahar", "ashlands", 495, 430, ["sandreach", "sunfall", "zephyr"]),
  t("zephyr", "Zephyr", "ashlands", 520, 520, ["kalahar", "sunfall", "moonrock"]),
  t("moonrock", "Moonrock", "ashlands", 605, 520, ["zephyr", "sunfall"]),

  // ---- Vastmark (12)
  t("uraltar", "Uraltar", "vastmark", 640, 140, ["duskvale", "stepwind", "khordan", "silkgate"]),
  t("silkgate", "Silkgate", "vastmark", 660, 225, ["uraltar", "duskvale", "mirzah", "sarkand", "khordan"]),
  t("mirzah", "Mirzah", "vastmark", 605, 285, ["silkgate", "duskvale", "cragspire", "emberwold", "sunfall", "sarkand"]),
  t("sarkand", "Sarkand", "vastmark", 700, 300, ["silkgate", "mirzah", "khordan", "monsoon"]),
  t("khordan", "Khordan", "vastmark", 760, 235, ["uraltar", "silkgate", "sarkand", "monsoon", "cinnabar", "stepwind", "jadeport"]),
  t("monsoon", "Monsoon", "vastmark", 790, 330, ["sarkand", "khordan", "reefhold"]),
  t("stepwind", "Stepwind", "vastmark", 715, 90, ["uraltar", "khordan", "tundravast", "yakut", "cinnabar"]),
  t("tundravast", "Tundra Vast", "vastmark", 800, 65, ["stepwind", "yakut", "farhold"]),
  t("yakut", "Yakut", "vastmark", 790, 140, ["stepwind", "tundravast", "farhold", "cinnabar"]),
  t("farhold", "Farhold", "vastmark", 890, 95, ["tundravast", "yakut", "cinnabar", "frostgate"]),
  t("cinnabar", "Cinnabar", "vastmark", 855, 185, ["khordan", "stepwind", "yakut", "farhold", "jadeport"]),
  t("jadeport", "Jadeport", "vastmark", 905, 260, ["cinnabar", "khordan"]),

  // ---- Coralia (4)
  t("reefhold", "Reefhold", "coralia", 830, 415, ["monsoon", "corallis", "windward"]),
  t("corallis", "Corallis", "coralia", 905, 425, ["reefhold", "windward", "thornreef"]),
  t("windward", "Windward", "coralia", 815, 505, ["reefhold", "corallis", "thornreef"]),
  t("thornreef", "Thornreef", "coralia", 900, 520, ["corallis", "windward"])
];

export const TERRITORY_KEYS = TERRITORIES.map((x) => x.key);
export const byKey = (key: string): Territory => TERRITORIES.find((x) => x.key === key)!;
export const regionOf = (key: string): Region => REGIONS.find((r) => r.key === byKey(key).region)!;
export const territoriesIn = (region: string): string[] =>
  TERRITORIES.filter((x) => x.region === region).map((x) => x.key);

/** Starting armies by table size. */
export const STARTING_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };

/** Set values: three matching or one of each, escalating. */
export const SET_VALUES = [4, 6, 8, 10, 12, 15];
export const setValue = (setsTradedSoFar: number): number =>
  SET_VALUES[setsTradedSoFar] ?? 15 + (setsTradedSoFar - SET_VALUES.length + 1) * 5;

export type Symbol = "spear" | "horse" | "engine";
export const SYMBOLS: Symbol[] = ["spear", "horse", "engine"];

export interface TerritoryCard {
  id: number;
  /** null on the two wild cards. */
  territory: string | null;
  symbol: Symbol | "wild";
}

/** Forty-two territory cards plus two wilds. */
export function makeCardDeck(): TerritoryCard[] {
  const cards: TerritoryCard[] = TERRITORY_KEYS.map((territory, i) => ({
    id: i,
    territory,
    symbol: SYMBOLS[i % 3]!
  }));
  cards.push({ id: 42, territory: null, symbol: "wild" });
  cards.push({ id: 43, territory: null, symbol: "wild" });
  return cards;
}

/** Is this a tradeable set — three alike, or one of each, wilds filling in? */
export function isSet(cards: TerritoryCard[]): boolean {
  if (cards.length !== 3) return false;
  const wilds = cards.filter((c) => c.symbol === "wild").length;
  const symbols = cards.filter((c) => c.symbol !== "wild").map((c) => c.symbol);
  if (wilds > 0) return true; // a wild completes anything
  const unique = new Set(symbols);
  return unique.size === 1 || unique.size === 3;
}

/** Every territory reachable from `from` through territories `owner` holds. */
export function connectedOwned(
  owner: (key: string) => number | null,
  seat: number,
  from: string
): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const key = queue.shift()!;
    for (const next of byKey(key).borders) {
      if (seen.has(next)) continue;
      if (owner(next) !== seat) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Odds that an attack of `a` dice against `d` dice loses no armies, loses one,
 * or loses both — computed once, at module load, by enumerating every roll.
 * The bot reads this table rather than guessing.
 */
export const BATTLE_ODDS: Record<string, { attackerLoses: number; defenderLoses: number }> = (() => {
  const table: Record<string, { attackerLoses: number; defenderLoses: number }> = {};
  for (let a = 1; a <= 3; a++) {
    for (let d = 1; d <= 2; d++) {
      let attackerLost = 0;
      let defenderLost = 0;
      let rolls = 0;
      const enumerate = (dice: number, current: number[], done: (v: number[]) => void): void => {
        if (current.length === dice) return done(current);
        for (let face = 1; face <= 6; face++) enumerate(dice, [...current, face], done);
      };
      enumerate(a, [], (attack) => {
        enumerate(d, [], (defence) => {
          rolls++;
          const { attacker, defender } = resolveDice(attack, defence);
          attackerLost += attacker;
          defenderLost += defender;
        });
      });
      table[`${a}v${d}`] = { attackerLoses: attackerLost / rolls, defenderLoses: defenderLost / rolls };
    }
  }
  return table;
})();

/** Sort both sets high to low, compare in pairs, defender wins ties. */
export function resolveDice(attack: number[], defence: number[]): { attacker: number; defender: number } {
  const a = [...attack].sort((x, y) => y - x);
  const d = [...defence].sort((x, y) => y - x);
  let attacker = 0;
  let defender = 0;
  for (let i = 0; i < Math.min(a.length, d.length); i++) {
    if (a[i]! > d[i]!) defender++;
    else attacker++;
  }
  return { attacker, defender };
}
