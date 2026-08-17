import Link from "next/link";
import { shelfEntries } from "@gambit/games";

export const metadata = {
  title: "Learn a game · Gambit",
  description: "Two minutes each, played on your own device, with nobody watching."
};

/**
 * The way in for somebody who has not played any of these.
 *
 * Every game already had a tutorial at `/learn/<game>`, reachable only from
 * that game's panel on the shelf — so the address people would actually try,
 * `/learn`, was a 404. This is the index it should always have had: eleven
 * games, how long each takes, and how hard it is, with nothing to join and
 * nobody to keep waiting.
 */
export default function LearnIndex() {
  const games = shelfEntries();

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px 80px" }}>
      <Link href="/" className="gambit-mini" style={{ textDecoration: "none" }}>
        ← shelf
      </Link>

      <h1 style={{ fontSize: 30, margin: "26px 0 6px", letterSpacing: "0.01em" }}>Learn a game</h1>
      <p style={{ color: "var(--mut)", fontSize: 15, margin: "0 0 30px", lineHeight: 1.6 }}>
        Two minutes each, played here on your own, with nobody waiting on you.
      </p>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))"
        }}
      >
        {games.map((game) => (
          <li key={game.id}>
            <Link
              href={`/learn/${game.id}`}
              style={{
                display: "grid",
                gap: 8,
                padding: "16px 18px",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                textDecoration: "none",
                color: "inherit",
                height: "100%"
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 26,
                    borderRadius: 3,
                    background: `hsl(${game.hue} 40% 45%)`,
                    flex: "0 0 auto"
                  }}
                />
                <span style={{ fontSize: 17, letterSpacing: "0.02em" }}>{game.name}</span>
              </span>
              {game.familiar && (
                <span style={{ fontSize: 12.5, color: "var(--mut)" }}>
                  our take on {game.familiar.title}
                </span>
              )}
              <span style={{ fontSize: 12.5, color: "var(--accent)", letterSpacing: "0.04em" }}>
                {game.kind}
              </span>
              <span style={{ fontSize: 13.5, color: "var(--mut)", lineHeight: 1.5 }}>
                {game.tagline}
              </span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
                {game.players} players · ~{game.minutes} min · complexity {game.complexity}/5
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
