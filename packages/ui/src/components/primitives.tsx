"use client";
/**
 * The furniture of the lounge. Everything reads CSS custom properties set by
 * <ThemeProvider>, so a component never knows which room it is standing in.
 */
import { motion } from "framer-motion";
import React from "react";
import { useSfx } from "../providers";
import { LOGO_PATH, LOGO_SWITCH_PATH } from "../brand";

type Div = React.HTMLAttributes<HTMLDivElement>;

export function Panel({
  children,
  inset,
  style,
  ...rest
}: Div & { inset?: boolean }) {
  return (
    <div
      {...rest}
      style={{
        background: inset ? "var(--panel2)" : "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        boxShadow: inset ? "none" : "var(--shadow-sm)",
        ...style
      }}
    >
      {children}
    </div>
  );
}

export function SmallCaps({ children, style, ...rest }: Div) {
  return (
    <div
      {...rest}
      style={{
        fontSize: 12,
        letterSpacing: 3,
        color: "var(--mut)",
        fontVariant: "small-caps",
        ...style
      }}
    >
      {children}
    </div>
  );
}

export function Meta({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      style={{
        fontSize: 12,
        padding: "4px 10px",
        borderRadius: 12,
        letterSpacing: 0.5,
        whiteSpace: "nowrap",
        border: `1px solid ${accent ? "var(--accent)" : "var(--line)"}`,
        color: accent ? "var(--accent)" : "var(--mut)"
      }}
    >
      {label}
    </span>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "ghost" | "quiet";
  cue?: string;
  full?: boolean;
};

export function Button({
  variant = "solid",
  cue = "tap",
  full,
  onClick,
  style,
  children,
  ...rest
}: ButtonProps) {
  const sfx = useSfx();
  const palette =
    variant === "solid"
      ? { background: "var(--accent)", color: "var(--bg)", border: "1px solid transparent" }
      : variant === "ghost"
        ? { background: "transparent", color: "var(--ink)", border: "1px solid var(--line)" }
        : { background: "transparent", color: "var(--mut)", border: "1px solid transparent" };

  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      onClick={(e) => {
        sfx(cue);
        onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
      }}
      style={{
        ...palette,
        borderRadius: 9,
        padding: "12px 20px",
        fontFamily: "inherit",
        fontSize: 15,
        fontWeight: variant === "solid" ? 700 : 500,
        letterSpacing: 0.3,
        cursor: "pointer",
        width: full ? "100%" : undefined,
        ...style
      }}
      {...(rest as React.ComponentProps<typeof motion.button>)}
    >
      {children}
    </motion.button>
  );
}

export function Chip({
  on,
  children,
  onClick
}: {
  on?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const sfx = useSfx();
  return (
    <button
      onClick={() => {
        sfx("select");
        onClick?.();
      }}
      style={{
        padding: "7px 14px",
        borderRadius: 20,
        fontSize: 13,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: "inherit",
        border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
        background: on ? "var(--accent)" : "transparent",
        color: on ? "var(--bg)" : "var(--mut)",
        transition: "all .18s ease"
      }}
    >
      {children}
    </button>
  );
}

/** The knight-with-a-rail-switch mark. */
export function Logo({ size = 28, title = "Gambit" }: { size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={title}>
      <path d={LOGO_PATH} fill="var(--ink)" />
      <path d={LOGO_SWITCH_PATH} stroke="var(--accent)" strokeWidth={4} fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function ConnectionDot({
  status,
  pingMs
}: {
  status: "connecting" | "live" | "reconnecting" | "offline";
  pingMs: number | null;
}) {
  const color =
    status === "live"
      ? pingMs !== null && pingMs > 400
        ? "#d5a24a"
        : "#5aa85f"
      : status === "offline"
        ? "#b4534f"
        : "#d5a24a";
  const label =
    status === "live"
      ? pingMs !== null
        ? `${Math.round(pingMs)}ms`
        : "live"
      : status;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--mut)" }}>
      <motion.span
        animate={status === "live" ? {} : { opacity: [1, 0.35, 1] }}
        transition={{ repeat: Infinity, duration: 1.2 }}
        style={{ width: 7, height: 7, borderRadius: 4, background: color, display: "inline-block" }}
      />
      {label}
    </div>
  );
}

/** Persistent event ticker — also the screen-reader move log. */
export function EventTicker({ events }: { events: { text?: string; type: string }[] }) {
  const lines = events.filter((e) => e.text).slice(-40);
  return (
    <div
      aria-live="polite"
      role="log"
      style={{
        maxHeight: 140,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column-reverse",
        gap: 4,
        fontSize: 13,
        color: "var(--mut)",
        lineHeight: 1.45
      }}
    >
      {lines
        .slice()
        .reverse()
        .map((e, i) => (
          <div key={`${e.type}-${lines.length - i}`} style={{ opacity: i === 0 ? 1 : 0.72 }}>
            {e.text}
          </div>
        ))}
    </div>
  );
}

/** One-line explanation of an illegal tap, or a rejected optimistic move. */
export function Toast({ message, onDone }: { message: string | null; onDone?: () => void }) {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => onDone?.(), 2600);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      style={{
        position: "fixed",
        bottom: 22,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        color: "var(--ink)",
        padding: "10px 16px",
        borderRadius: 10,
        boxShadow: "var(--shadow)",
        fontSize: 14,
        zIndex: 60,
        maxWidth: "90vw"
      }}
      role="status"
    >
      {message}
    </motion.div>
  );
}
