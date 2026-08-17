import Link from "next/link";

export const metadata = {
  title: "If you already know these games · Gambit",
  description:
    "Gambit's eleven games are original implementations. This page says plainly which well-known games they will feel familiar to, and who owns those names."
};

/**
 * The whole shelf, and what each game will feel familiar to.
 *
 * Each cover now says its own ("our take on Ticket to Ride"), so this is no
 * longer the only place these titles appear — it is the page that gathers them
 * and names the publisher of every one.
 *
 * This is nominative use: naming a product in order to describe a genuine
 * similarity to it. That is a narrow doorway, and it stays open only while
 * three things are true, which is why they are all on the page rather than in
 * a footnote:
 *
 *   * the games here are our own — our rules text, our maps, our art;
 *   * the titles belong to their publishers and are marked as theirs;
 *   * nothing suggests any of them had a hand in this, endorsed it, or knows
 *     it exists.
 *
 * The shelf carries the same attribution in its footer. What none of them
 * carry is somebody else's title as part of a game's own name, its rules, or
 * anything in the code — see the guard in registry.test.ts, and LEGAL.md.
 */

interface Row {
  ours: string;
  kind: string;
  familiar: string;
  owner: string;
}

const ROWS: Row[] = [
  {
    ours: "Boxcar",
    kind: "Route building",
    familiar: "Ticket to Ride",
    owner: "Days of Wonder"
  },
  {
    ours: "Landfall",
    kind: "Resource trading",
    familiar: "CATAN",
    owner: "Catan GmbH"
  },
  { ours: "Quintet", kind: "Cards and a board", familiar: "Sequence", owner: "Jax Ltd." },
  {
    ours: "Phantom",
    kind: "Hidden movement",
    familiar: "Scotland Yard",
    owner: "Ravensburger"
  },
  { ours: "Motive", kind: "Deduction", familiar: "Cluedo / Clue", owner: "Hasbro" },
  { ours: "Hamlet", kind: "Tile laying", familiar: "Carcassonne", owner: "Hans im Glück" },
  { ours: "Mosaic", kind: "Tile drafting", familiar: "Azul", owner: "Next Move Games" },
  { ours: "Facet", kind: "Engine building", familiar: "Splendor", owner: "Space Cowboys" },
  { ours: "Stronghold", kind: "Area control", familiar: "Risk", owner: "Hasbro" },
  { ours: "Remedy", kind: "Co-operative", familiar: "Pandemic", owner: "Z-Man Games" }
];

export default function ComparePage() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px 80px" }}>
      <Link href="/" className="gambit-mini" style={{ textDecoration: "none" }}>
        ← shelf
      </Link>

      <h1 style={{ fontSize: 30, margin: "26px 0 10px", letterSpacing: "0.01em" }}>
        If you already know these games
      </h1>
      <p style={{ color: "var(--mut)", fontSize: 15, margin: "0 0 8px", lineHeight: 1.65 }}>
        Gambit&rsquo;s games are our own: our rules, our maps, our boards, our art, written and
        drawn for this table. Several of them sit in genres that other games made famous, and if
        you have played those, you will be at home here in about a minute.
      </p>
      <p style={{ color: "var(--mut)", fontSize: 15, margin: "0 0 30px", lineHeight: 1.65 }}>
        Each game says so on its own cover. This is the whole shelf at once, with the publisher of
        every title named.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14.5, minWidth: 520 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--mut)" }}>
              <th style={{ padding: "10px 12px", fontWeight: 400, fontSize: 12, letterSpacing: "0.08em" }}>
                ON THE SHELF
              </th>
              <th style={{ padding: "10px 12px", fontWeight: 400, fontSize: 12, letterSpacing: "0.08em" }}>
                KIND OF GAME
              </th>
              <th style={{ padding: "10px 12px", fontWeight: 400, fontSize: 12, letterSpacing: "0.08em" }}>
                FAMILIAR IF YOU KNOW
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.ours} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "13px 12px", letterSpacing: "0.03em" }}>{row.ours}</td>
                <td style={{ padding: "13px 12px", color: "var(--mut)" }}>{row.kind}</td>
                <td style={{ padding: "13px 12px", color: "var(--mut)" }}>
                  {row.familiar}
                  <span style={{ fontSize: 12, opacity: 0.75 }}> · {row.owner}</span>
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: "13px 12px", letterSpacing: "0.03em" }}>Chess</td>
              <td style={{ padding: "13px 12px", color: "var(--mut)" }}>Classic strategy</td>
              <td style={{ padding: "13px 12px", color: "var(--mut)" }}>
                Chess<span style={{ fontSize: 12, opacity: 0.75 }}> · nobody&rsquo;s, and everybody&rsquo;s</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section
        style={{
          marginTop: 34,
          padding: "18px 20px",
          border: "1px solid var(--line)",
          borderRadius: 12,
          background: "var(--panel)"
        }}
      >
        <h2 style={{ fontSize: 15, margin: "0 0 10px", letterSpacing: "0.04em" }}>
          What that does and does not mean
        </h2>
        <p style={{ color: "var(--mut)", fontSize: 13.5, lineHeight: 1.7, margin: "0 0 10px" }}>
          Rules and systems are not anybody&rsquo;s property, and every game ever made is built on
          the ones before it. Names, boards, maps, card art and box designs <em>are</em> property,
          and we have never used any of them. Every map here was drawn for Gambit; every rule was
          written in our own words; every sound is generated on your device.
        </p>
        <p style={{ color: "var(--mut)", fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
          The names in the right-hand column are the trade marks of their respective owners, named
          here only to describe what our games resemble. Gambit is not affiliated with, endorsed
          by, sponsored by, or connected to any of them, and none of their games are available
          here.
        </p>
      </section>

      <p style={{ marginTop: 26, fontSize: 13.5 }}>
        <Link href="/learn" style={{ color: "var(--accent)" }}>
          Learn any of them in two minutes →
        </Link>
      </p>
    </main>
  );
}
