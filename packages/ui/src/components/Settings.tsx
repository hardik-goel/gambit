"use client";
/** Theme picker and the three sound channels — live preview, nothing modal. */
import React, { useRef } from "react";
import { motion } from "framer-motion";
import { useAudio, useTheme } from "../providers";
import { THEMES, THEME_IDS, type ThemeId } from "../themes";
import { Panel, SmallCaps } from "./primitives";

export function ThemePicker({ compact }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { sfx } = useAudio();
  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center" }} role="radiogroup" aria-label="Room theme">
      {THEME_IDS.map((id) => {
        const th = THEMES[id];
        const on = theme === id;
        return (
          <motion.button
            key={id}
            role="radio"
            aria-checked={on}
            aria-label={th.label}
            title={th.label}
            whileHover={{ scale: 1.15 }}
            animate={{ scale: on ? 1.2 : 1 }}
            onClick={() => {
              setTheme(id as ThemeId);
              sfx("select");
            }}
            style={{
              width: compact ? 16 : 20,
              height: compact ? 16 : 20,
              borderRadius: "50%",
              cursor: "pointer",
              padding: 0,
              background: `linear-gradient(135deg, ${th.bg} 50%, ${th.accent} 50%)`,
              border: on ? "2px solid var(--ink)" : "1px solid var(--line)"
            }}
          />
        );
      })}
    </div>
  );
}

export function SoundPanel() {
  const { settings, update, engine } = useAudio();
  const fileRef = useRef<HTMLInputElement>(null);

  const row = (
    key: "ui" | "foley" | "music",
    label: string,
    hint: string,
    vol: "uiVolume" | "foleyVolume" | "musicVolume"
  ) => (
    <div key={key} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 15 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--mut)" }}>{hint}</div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings[vol]}
          disabled={!settings[key]}
          onChange={(e) => update({ [vol]: Number(e.target.value) } as never)}
          aria-label={`${label} volume`}
          style={{ width: "100%", marginTop: 6, accentColor: "var(--accent)" }}
        />
      </div>
      <button
        role="switch"
        aria-checked={settings[key]}
        aria-label={label}
        onClick={() => update({ [key]: !settings[key] } as never)}
        style={{
          width: 46,
          height: 26,
          borderRadius: 13,
          border: "1px solid var(--line)",
          background: settings[key] ? "var(--accent)" : "var(--panel2)",
          position: "relative",
          cursor: "pointer"
        }}
      >
        <motion.span
          animate={{ x: settings[key] ? 20 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          style={{
            position: "absolute",
            top: 2,
            left: 0,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: settings[key] ? "var(--bg)" : "var(--mut)"
          }}
        />
      </button>
    </div>
  );

  return (
    <Panel style={{ padding: 18, display: "grid", gap: 16 }}>
      <SmallCaps>sound</SmallCaps>
      {row("ui", "Interface", "Taps, sheets, confirmations.", "uiVolume")}
      {row("foley", "Table foley", "Cards, chips, dice, trains.", "foleyVolume")}
      {row("music", "Music", "Lounge loops, flavoured by your theme.", "musicVolume")}

      <div>
        <div style={{ fontSize: 15 }}>Bring your own music</div>
        <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 8 }}>
          Plays from this device only. Nothing is uploaded.
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              engine.unlock();
              engine.playLocalTrack(f);
              update({ music: true });
            }
          }}
          style={{ fontSize: 13, color: "var(--mut)" }}
        />
      </div>
    </Panel>
  );
}
