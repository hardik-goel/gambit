import Link from "next/link";

export const metadata = { title: "Nothing here · Gambit" };

/**
 * The page for a room code that was mistyped, a game that was never on the
 * shelf, and every other address that does not exist.
 *
 * Until now this was Next's own 404: black text on a black background, wearing
 * none of the product's clothes. A wrong room code is the single likeliest
 * mistake anybody makes here — six characters read aloud across a room — so it
 * is worth answering properly, and worth offering the way back rather than
 * simply reporting the fact.
 */
export default function NotFound() {
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
      <div style={{ display: "grid", gap: 18, maxWidth: 460 }}>
        <div style={{ fontSize: 46, lineHeight: 1 }} aria-hidden>
          ♟
        </div>
        <h1 style={{ fontSize: 26, margin: 0, letterSpacing: "0.01em" }}>No table here</h1>
        <p style={{ margin: 0, color: "var(--mut)", fontSize: 15, lineHeight: 1.6 }}>
          That address doesn&rsquo;t lead anywhere. If somebody read you a room code, it is six
          characters — letters and numbers, no spaces — and it goes in the box on the shelf.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link
            href="/"
            className="gambit-mini"
            style={{
              textDecoration: "none",
              borderColor: "var(--accent)",
              color: "var(--accent)",
              padding: "10px 18px"
            }}
          >
            Back to the shelf
          </Link>
          <Link
            href="/learn"
            className="gambit-mini"
            style={{ textDecoration: "none", padding: "10px 18px" }}
          >
            Learn a game
          </Link>
        </div>
      </div>
    </main>
  );
}
