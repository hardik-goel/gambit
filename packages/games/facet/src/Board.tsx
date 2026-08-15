"use client";
/**
 * The Facet table: three rows of cards, the patrons above, the bank below, and
 * your own engine along the bottom. Cards you can afford are lit; cards you
 * can't say how far off they are.
 */
import { motion } from "framer-motion";
import React from "react";
import type { BoardProps } from "@gambit/sdk";
import { GEMS, GEM_HEX, GOLD, type DevCard, type Gem } from "./cards";
import type { FacetMove, FacetView } from "./state";

const GOLD_HEX = "#d6b25a";

function Token({ gem, count, onClick, dim }: { gem: number; count?: number; onClick?(): void; dim?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-label={`${gem === GOLD ? "gold" : GEMS[gem]}${count !== undefined ? `, ${count}` : ""}`}
      style={{
        width: 38,
        height: 38,
        borderRadius: "50%",
        border: onClick ? "2px solid var(--accent)" : "1px solid rgba(0,0,0,.35)",
        background: gem === GOLD ? GOLD_HEX : GEM_HEX[gem],
        color: "#f6efe2",
        fontSize: 13,
        cursor: onClick ? "pointer" : "default",
        opacity: dim ? 0.35 : 1,
        boxShadow: "inset 0 -3px 6px rgba(0,0,0,.35)"
      }}
    >
      {count}
    </button>
  );
}

function Card({
  card,
  affordable,
  onBuy,
  onReserve,
  discounts,
  tokens
}: {
  card: DevCard;
  affordable: boolean;
  onBuy?(): void;
  onReserve?(): void;
  discounts: number[];
  tokens: number[];
}) {
  return (
    <motion.div
      layout
      whileHover={{ y: -3 }}
      style={{
        width: 96,
        borderRadius: 10,
        border: `1px solid ${affordable ? "var(--accent)" : "var(--line)"}`,
        background: "var(--panel)",
        padding: 8,
        display: "grid",
        gap: 6,
        boxShadow: affordable ? "var(--shadow-sm)" : "none"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{card.prestige || ""}</span>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: GEM_HEX[card.gem],
            border: "1px solid rgba(0,0,0,.3)"
          }}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {card.cost.map((n, gem) => {
          if (n === 0) return null;
          const net = Math.max(0, n - (discounts[gem] ?? 0));
          const short = net > (tokens[gem] ?? 0);
          return (
            <span
              key={gem}
              title={`${n} ${GEMS[gem]}`}
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: GEM_HEX[gem],
                color: "#f6efe2",
                fontSize: 11,
                display: "grid",
                placeItems: "center",
                opacity: net === 0 ? 0.35 : 1,
                outline: short ? "1px solid #d1685c" : "none"
              }}
            >
              {net}
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {onBuy && (
          <button className="gambit-mini" style={{ flex: 1, padding: "4px 6px" }} onClick={onBuy}>
            Buy
          </button>
        )}
        {onReserve && (
          <button className="gambit-mini" style={{ padding: "4px 6px" }} onClick={onReserve} title="Reserve">
            ✋
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function Board({ view, legal, seat, play, sfx }: BoardProps<FacetView, FacetMove>) {
  const mySeat = seat ?? view.turn;
  const me = view.players[mySeat];
  const discounts = [0, 0, 0, 0, 0];
  for (const c of me?.bought ?? []) discounts[c.gem]!++;

  const buys = new Map<string, FacetMove>();
  const reserves = new Map<string, FacetMove>();
  const take3 = legal.filter((m): m is Extract<FacetMove, { kind: "take3" }> => m.kind === "take3");
  const take2 = legal.filter((m): m is Extract<FacetMove, { kind: "take2" }> => m.kind === "take2");
  const returns = legal.filter((m): m is Extract<FacetMove, { kind: "return" }> => m.kind === "return");
  const nobleChoices = legal.filter((m): m is Extract<FacetMove, { kind: "noble" }> => m.kind === "noble");

  for (const m of legal) {
    if (m.kind === "buy") buys.set(m.source === "reserve" ? `r-${m.index}` : `${m.tier}-${m.index}`, m);
    if (m.kind === "reserve" && m.index >= 0) reserves.set(`${m.tier}-${m.index}`, m);
  }

  const gemsWith = (gem: Gem) => take3.filter((m) => m.gems.includes(gem));

  return (
    <div style={{ display: "grid", gap: 14, width: "min(96vw, 760px)" }}>
      {view.pending && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--panel)",
            border: "1px solid var(--accent)",
            fontSize: 14
          }}
        >
          {view.pending.prompt}
          {view.pending.kind === "return-tokens" && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {returns.map((m) => (
                <Token key={m.gem} gem={m.gem} onClick={() => play(m)} />
              ))}
            </div>
          )}
          {view.pending.kind === "choose-noble" && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {nobleChoices.map((m) => (
                <button key={m.index} className="gambit-mini" onClick={() => play(m)}>
                  Patron {m.index + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* patrons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {view.nobles.map((n) => (
          <div
            key={n.id}
            style={{
              padding: 8,
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--panel2)",
              display: "grid",
              gap: 4,
              minWidth: 74
            }}
          >
            <div style={{ fontSize: 12, color: "var(--accent)" }}>{n.prestige} prestige</div>
            <div style={{ display: "flex", gap: 3 }}>
              {n.requirement.map((need, gem) =>
                need ? (
                  <span
                    key={gem}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      background: GEM_HEX[gem],
                      color: "#f6efe2",
                      fontSize: 10,
                      display: "grid",
                      placeItems: "center"
                    }}
                  >
                    {need}
                  </span>
                ) : null
              )}
            </div>
          </div>
        ))}
      </div>

      {/* the three rows */}
      {([3, 2, 1] as const).map((tier) => (
        <div key={tier} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "var(--mut)", width: 26 }}>
            {"·".repeat(tier)}
            <div>{view.deckCounts[tier]}</div>
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
            {view.rows[tier].map((card, index) =>
              card ? (
                <Card
                  key={card.id}
                  card={card}
                  discounts={discounts}
                  tokens={me?.tokens ?? []}
                  affordable={buys.has(`${tier}-${index}`)}
                  onBuy={
                    buys.has(`${tier}-${index}`)
                      ? () => {
                          sfx("gemClink");
                          play(buys.get(`${tier}-${index}`)!);
                        }
                      : undefined
                  }
                  onReserve={
                    reserves.has(`${tier}-${index}`)
                      ? () => {
                          sfx("cardSlip");
                          play(reserves.get(`${tier}-${index}`)!);
                        }
                      : undefined
                  }
                />
              ) : (
                <div
                  key={index}
                  style={{ width: 96, borderRadius: 10, border: "1px dashed var(--line)", opacity: 0.4 }}
                />
              )
            )}
          </div>
        </div>
      ))}

      {/* the bank */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {view.bank.map((count, gem) => {
          const two = take2.find((m) => m.gem === gem);
          const threes = gem < 5 ? gemsWith(gem as Gem) : [];
          return (
            <div key={gem} style={{ display: "grid", gap: 4, justifyItems: "center" }}>
              <Token
                gem={gem}
                count={count}
                dim={count === 0}
                onClick={
                  threes.length
                    ? () => {
                        sfx("gemClink");
                        play(threes[0]!);
                      }
                    : undefined
                }
              />
              {two && (
                <button className="gambit-mini" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => play(two)}>
                  take 2
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* players */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {Object.keys(view.players)
          .map(Number)
          .map((s) => {
            const p = view.players[s]!;
            const d = [0, 0, 0, 0, 0];
            for (const c of p.bought) d[c.gem]!++;
            return (
              <div
                key={s}
                className={view.turn === s ? "gambit-turn" : undefined}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${view.turn === s ? "var(--accent)" : "var(--line)"}`,
                  background: "var(--panel)",
                  minWidth: 160
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{view.names[s]}</span>
                  <span style={{ color: "var(--accent)" }}>{p.prestige}</span>
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                  {d.map((n, gem) => (
                    <span key={gem} style={{ fontSize: 11, color: GEM_HEX[gem] }}>
                      {n}▮
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: "var(--mut)" }}>
                    · {p.tokens.reduce((a, b) => a + b, 0)} tokens · {p.reservedCount} held
                  </span>
                </div>
              </div>
            );
          })}
      </div>

      {view.reserved.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "var(--mut)", marginBottom: 6 }}>your reserved cards</div>
          <div style={{ display: "flex", gap: 8 }}>
            {view.reserved.map((card, index) => (
              <Card
                key={card.id}
                card={card}
                discounts={discounts}
                tokens={me?.tokens ?? []}
                affordable={buys.has(`r-${index}`)}
                onBuy={buys.has(`r-${index}`) ? () => play(buys.get(`r-${index}`)!) : undefined}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
