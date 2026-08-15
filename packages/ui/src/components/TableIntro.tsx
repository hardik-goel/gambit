"use client";
/**
 * The 1.5s walk from the shelf to the felt: the box opens, the light drops, the
 * table settles. Skippable on any input, and instant under reduced motion.
 */
import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect, useState } from "react";
import { useReducedMotion, useSfx } from "../providers";

export function TableIntro({
  gameName,
  hue,
  felt,
  onDone
}: {
  gameName: string;
  hue: string;
  felt: string;
  onDone(): void;
}) {
  const reduced = useReducedMotion();
  const sfx = useSfx();
  const [gone, setGone] = useState(false);

  useEffect(() => {
    sfx("swoosh");
    const t = setTimeout(() => finish(), reduced ? 0 : 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish() {
    if (gone) return;
    setGone(true);
    onDone();
  }

  return (
    <AnimatePresence>
      {!gone && (
        <motion.div
          onClick={finish}
          onKeyDown={finish}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: felt,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            overflow: "hidden"
          }}
          aria-label={`Opening ${gameName}. Tap to skip.`}
          role="button"
          tabIndex={0}
        >
          <motion.div
            initial={{ scale: 0.35, rotate: -4, opacity: 0 }}
            animate={{ scale: reduced ? 1 : [0.35, 1.08, 1], rotate: 0, opacity: 1 }}
            transition={{ duration: reduced ? 0 : 1.1, times: [0, 0.7, 1], ease: [0.2, 0.9, 0.2, 1] }}
            style={{
              width: 220,
              height: 150,
              borderRadius: 12,
              background: `linear-gradient(145deg, ${hue}, ${hue}99)`,
              boxShadow: "0 30px 60px rgba(0,0,0,.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#f6efe2",
              fontSize: 24,
              letterSpacing: 5,
              fontWeight: 700
            }}
          >
            {gameName.toUpperCase()}
          </motion.div>

          {/* lamp glow dropping over the table */}
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 0.5, scale: 1.6 }}
            transition={{ duration: 1.4 }}
            style={{
              position: "absolute",
              width: 520,
              height: 520,
              borderRadius: "50%",
              background: "radial-gradient(circle, var(--glow) 0%, transparent 65%)",
              pointerEvents: "none",
              mixBlendMode: "soft-light"
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 26,
              fontSize: 12,
              letterSpacing: 2,
              color: "#f6efe2aa"
            }}
          >
            tap to skip
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
