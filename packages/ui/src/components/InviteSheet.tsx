"use client";
/**
 * "Play here" — the ten-second aha.
 *
 * Full-screen code, big enough to scan across a coffee table, plus the share
 * link for everyone who isn't in the room. Time-to-seated is the metric this
 * screen exists to protect.
 */
import { motion } from "framer-motion";
import QRCode from "qrcode";
import React, { useEffect, useRef, useState } from "react";
import { useSfx, useTheme } from "../providers";
import { Button, Panel, SmallCaps } from "./primitives";

export function InviteSheet({
  code,
  url,
  gameName,
  mode,
  onClose,
  onEnter
}: {
  code: string;
  url: string;
  gameName: string;
  mode: "here" | "online";
  onClose(): void;
  onEnter(): void;
}) {
  const { tokens } = useTheme();
  const sfx = useSfx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (mode !== "here" || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, url, {
      width: 260,
      margin: 1,
      color: { dark: tokens.ink, light: tokens.panel2 }
    });
  }, [url, mode, tokens]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      sfx("tap");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied — the link is on screen anyway */
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.74)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16
      }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 24, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        style={{ width: 360, maxWidth: "94vw" }}
      >
        <Panel style={{ padding: 24, textAlign: "center" }}>
          <SmallCaps>
            {mode === "here" ? "same-room table" : "online table"} · {gameName}
          </SmallCaps>
          <div style={{ fontSize: 36, letterSpacing: 8, fontWeight: 700, margin: "10px 0 16px" }}>
            {code.slice(0, 3)}·{code.slice(3)}
          </div>

          {mode === "here" ? (
            <>
              <canvas
                ref={canvasRef}
                width={260}
                height={260}
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                  background: "var(--panel2)",
                  maxWidth: "100%"
                }}
                aria-label={`QR code to join table ${code}`}
              />
              <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 12 }}>
                Friends scan to sit down. No app, no account — they're at the table in seconds.
              </p>
            </>
          ) : (
            <>
              <button
                onClick={copy}
                style={{
                  background: "var(--panel2)",
                  border: "1px dashed var(--line)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontSize: 14,
                  color: "var(--ink)",
                  width: "100%",
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}
              >
                {copied ? "Link copied" : url}
              </button>
              <p style={{ fontSize: 13, color: "var(--mut)", marginTop: 12 }}>
                Send it anywhere. They tap, they're seated — wherever they are.
              </p>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Game of ${gameName}? ${url}`)}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13, color: "var(--accent)" }}
              >
                Share on WhatsApp
              </a>
            </>
          )}

          <Button full style={{ marginTop: 16 }} cue="open" onClick={onEnter}>
            Open the lobby
          </Button>
        </Panel>
      </motion.div>
    </div>
  );
}
