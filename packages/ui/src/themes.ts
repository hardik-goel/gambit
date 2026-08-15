/**
 * Shell themes — the player owns the room.
 *
 * A theme is one token set. Per-game skins layer on top via `themeTokens`, so
 * a game never has to know which room it is being played in. Every pairing of
 * `ink` on `bg`/`panel` clears WCAG AA (4.5:1); `mut` clears AA for large text
 * and is only ever used at 12px+ with letterspacing, or for non-essential chrome.
 */

export interface ThemeTokenSet {
  label: string;
  /** Page background — the room. */
  bg: string;
  /** Raised surfaces — cards, sheets, trays. */
  panel: string;
  /** Deeper inset surfaces — wells, secondary rows. */
  panel2: string;
  /** Hairlines and edges. */
  line: string;
  /** Primary text. */
  ink: string;
  /** Secondary text, labels, small caps. */
  mut: string;
  /** The metal: buttons, focus rings, highlights. */
  accent: string;
  /** Table surface under a board. */
  felt: string;
  /** Warm light bloom for lamp-glow effects. */
  glow: string;
  /** Card backs and box spines base. */
  backing: string;
  /** True for dark rooms — drives shadow strength and image treatment. */
  dark: boolean;
}

export const THEMES = {
  cocoa: {
    label: "Cocoa",
    bg: "#1a120c", panel: "#241811", panel2: "#2e2016", line: "#3d2c1d",
    ink: "#ede3d4", mut: "#b39c85", accent: "#d18a4f", felt: "#20150e",
    glow: "#ffb469", backing: "#3a281a", dark: true
  },
  linen: {
    label: "Linen",
    bg: "#efe7d8", panel: "#f7f1e5", panel2: "#e7dcc6", line: "#cdb994",
    ink: "#2b2116", mut: "#6f6045", accent: "#9a5a26", felt: "#e4d8bd",
    glow: "#ffdfa8", backing: "#d9c8a6", dark: false
  },
  regalia: {
    label: "Regalia",
    bg: "#0e1626", panel: "#15203a", panel2: "#1b2a4a", line: "#2c3d61",
    ink: "#eee7d5", mut: "#9fb0cf", accent: "#d5ae55", felt: "#111c31",
    glow: "#ffd98a", backing: "#1d2c4c", dark: true
  },
  oxblood: {
    label: "Oxblood",
    bg: "#1c0e10", panel: "#291418", panel2: "#341a1f", line: "#4a262d",
    ink: "#efe1d6", mut: "#bb9a95", accent: "#d4924f", felt: "#231114",
    glow: "#ff9f6b", backing: "#3a1c22", dark: true
  },
  empress: {
    label: "Empress",
    bg: "#0d1a15", panel: "#13251d", panel2: "#193028", line: "#28453a",
    ink: "#efe9d8", mut: "#9db8a8", accent: "#d3bd72", felt: "#102019",
    glow: "#ffe7a4", backing: "#1a3228", dark: true
  },
  amethyst: {
    label: "Amethyst",
    bg: "#151020", panel: "#1e172e", panel2: "#27203a", line: "#3a3054",
    ink: "#e9e4f0", mut: "#a99ec4", accent: "#c1a9e0", felt: "#191330",
    glow: "#d9bcff", backing: "#2b2340", dark: true
  }
} as const satisfies Record<string, ThemeTokenSet>;

export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const DEFAULT_THEME: ThemeId = "cocoa";

/** Emit the token set as CSS custom properties for a `style` attribute. */
export function themeVars(id: ThemeId): Record<string, string> {
  const t = THEMES[id];
  return {
    "--bg": t.bg,
    "--panel": t.panel,
    "--panel2": t.panel2,
    "--line": t.line,
    "--ink": t.ink,
    "--mut": t.mut,
    "--accent": t.accent,
    "--felt": t.felt,
    "--glow": t.glow,
    "--backing": t.backing,
    "--shadow": t.dark ? "0 14px 30px rgba(0,0,0,.45)" : "0 14px 30px rgba(90,70,40,.18)",
    "--shadow-sm": t.dark ? "0 6px 14px rgba(0,0,0,.35)" : "0 6px 14px rgba(90,70,40,.14)"
  };
}

/** Music flavour per theme — see the audio engine. */
export const THEME_MUSIC: Record<ThemeId, string> = {
  cocoa: "brushed-jazz",
  linen: "parlour",
  regalia: "strings",
  oxblood: "smoke",
  empress: "reverie",
  amethyst: "nocturne"
};
