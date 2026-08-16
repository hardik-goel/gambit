"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * When something breaks mid-game.
 *
 * There was no error boundary at all, which means any render fault took the
 * whole screen with it and left a blank page — the worst possible thing to
 * happen to somebody halfway through a game with friends waiting.
 *
 * The important message is that the table is not lost: state lives on the
 * server, so reloading puts them back where they were. Trying again is
 * offered first because it usually works.
 */
export default function ErrorScreen({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[gambit] screen failed", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "70vh",
        display: "grid",
        placeItems: "center",
        padding: "10vh 24px",
        textAlign: "center"
      }}
    >
      <div style={{ display: "grid", gap: 18, maxWidth: 480 }}>
        <div style={{ fontSize: 42, lineHeight: 1 }} aria-hidden>
          ⚑
        </div>
        <h1 style={{ fontSize: 25, margin: 0 }}>Something went wrong on this screen</h1>
        <p style={{ margin: 0, color: "var(--mut)", fontSize: 15, lineHeight: 1.6 }}>
          Your table is safe — games live on the server, not in this window. Try again, and if it
          keeps happening go back to the shelf and rejoin with your room code.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            className="gambit-mini"
            onClick={reset}
            style={{ borderColor: "var(--accent)", color: "var(--accent)", padding: "10px 18px" }}
          >
            Try again
          </button>
          <Link href="/" className="gambit-mini" style={{ textDecoration: "none", padding: "10px 18px" }}>
            Back to the shelf
          </Link>
        </div>
        {error.digest && (
          <span style={{ fontSize: 12, color: "var(--mut)" }}>reference {error.digest}</span>
        )}
      </div>
    </main>
  );
}
