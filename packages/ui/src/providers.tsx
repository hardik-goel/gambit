"use client";
/**
 * Room providers: the theme the player chose, the sound they allowed, and the
 * motion they can tolerate. Everything below reads these, nothing re-implements
 * them.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { AudioEngine, loadAudioSettings, type AudioSettings } from "./audio";
import { DEFAULT_THEME, THEME_MUSIC, THEMES, themeVars, type ThemeId } from "./themes";

const THEME_KEY = "gambit.theme";

interface ThemeCtx {
  theme: ThemeId;
  setTheme(id: ThemeId): void;
  tokens: (typeof THEMES)[ThemeId];
  vars: Record<string, string>;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({
  children,
  initial = DEFAULT_THEME
}: {
  children: React.ReactNode;
  initial?: ThemeId;
}) {
  const [theme, setThemeState] = useState<ThemeId>(initial);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY) as ThemeId | null;
      if (saved && saved in THEMES) setThemeState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<ThemeCtx>(
    () => ({ theme, setTheme, tokens: THEMES[theme], vars: themeVars(theme) }),
    [theme, setTheme]
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v);
    root.dataset.theme = theme;
    root.style.colorScheme = THEMES[theme].dark ? "dark" : "light";
  }, [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ audio */

interface AudioCtx {
  engine: AudioEngine;
  settings: AudioSettings;
  update(patch: Partial<AudioSettings>): void;
  sfx(cue: string, opts?: { gain?: number }): void;
  duck(ms?: number): void;
  unlocked: boolean;
}

const AudioContextRef = createContext<AudioCtx | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine(loadAudioSettings());
  const engine = engineRef.current;
  const [settings, setSettings] = useState<AudioSettings>(engine.current);
  const [unlocked, setUnlocked] = useState(false);
  const theme = useContext(ThemeContext);

  // Autoplay policy: the first gesture anywhere in the room unlocks audio.
  useEffect(() => {
    const unlock = () => {
      engine.unlock();
      setUnlocked(true);
    };
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", unlock, opts);
    window.addEventListener("keydown", unlock, opts);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [engine]);

  // Music follows the room's flavour.
  useEffect(() => {
    if (!unlocked || !settings.music || !theme) return;
    engine.startMusic(THEME_MUSIC[theme.theme]);
    return () => engine.stopMusic();
  }, [engine, unlocked, settings.music, theme?.theme, theme]);

  const update = useCallback(
    (patch: Partial<AudioSettings>) => {
      engine.unlock();
      setSettings(engine.update(patch));
      setUnlocked(true);
    },
    [engine]
  );

  const sfx = useCallback(
    (cue: string, opts?: { gain?: number }) => {
      engine.play(cue, opts);
    },
    [engine]
  );

  const duck = useCallback((ms?: number) => engine.duck(ms), [engine]);

  const value = useMemo<AudioCtx>(
    () => ({ engine, settings, update, sfx, duck, unlocked }),
    [engine, settings, update, sfx, duck, unlocked]
  );

  return <AudioContextRef.Provider value={value}>{children}</AudioContextRef.Provider>;
}

export function useAudio(): AudioCtx {
  const ctx = useContext(AudioContextRef);
  if (!ctx) throw new Error("useAudio must be used inside <AudioProvider>");
  return ctx;
}

/** Convenience for boards: `const sfx = useSfx(); sfx("cardSlip")`. */
export function useSfx(): (cue: string, opts?: { gain?: number }) => void {
  return useAudio().sfx;
}

/* -------------------------------------------------------- reduced motion */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Short haptic pulse where the platform allows it. Silent no-op elsewhere. */
export function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* desktop */
  }
}

export function GambitProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AudioProvider>{children}</AudioProvider>
    </ThemeProvider>
  );
}
