"use client";
/**
 * The result share card — the distribution loop.
 *
 * Drawn on a canvas at 1080×1080 (the size WhatsApp and Instagram treat
 * kindly), handed to the native share sheet where one exists and saved as a
 * file where it doesn't. Everything is drawn from theme tokens, so the card
 * looks like the room the game was actually played in.
 */
import type { FinalScore, Seat } from "@gambit/sdk";
import { BRAND, DOMAIN, TAGLINE } from "./brand";
import { THEMES, type ThemeId } from "./themes";

export interface ShareCardInput {
  gameName: string;
  hue: string;
  theme: ThemeId;
  scores: FinalScore[];
  seats: Seat[];
  /** Optional line under the title, e.g. "45 minutes · 3 maps". */
  subtitle?: string;
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const S = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  const t = THEMES[input.theme];

  // felt with a lamp overhead
  ctx.fillStyle = t.felt;
  ctx.fillRect(0, 0, S, S);
  const glow = ctx.createRadialGradient(S / 2, 210, 40, S / 2, 260, 700);
  glow.addColorStop(0, hexA(t.glow, 0.22));
  glow.addColorStop(1, hexA(t.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // brass rule + wordmark
  ctx.fillStyle = t.accent;
  ctx.fillRect(80, 96, 56, 4);
  ctx.font = "700 34px Georgia, 'Times New Roman', serif";
  ctx.fillStyle = t.ink;
  ctx.letterSpacing = "10px";
  ctx.fillText(BRAND.toUpperCase(), 80, 150);
  ctx.letterSpacing = "3px";
  ctx.font = "20px Georgia, serif";
  ctx.fillStyle = t.mut;
  ctx.fillText(TAGLINE, 80, 184);

  // game title
  ctx.letterSpacing = "6px";
  ctx.font = "700 84px Georgia, serif";
  ctx.fillStyle = input.hue;
  ctx.fillText(input.gameName.toUpperCase(), 80, 320);
  if (input.subtitle) {
    ctx.letterSpacing = "2px";
    ctx.font = "24px Georgia, serif";
    ctx.fillStyle = t.mut;
    ctx.fillText(input.subtitle, 80, 362);
  }

  // scoreboard
  const ordered = input.scores.slice().sort((a, b) => a.rank - b.rank);
  let y = 440;
  ctx.letterSpacing = "0px";
  for (const s of ordered.slice(0, 6)) {
    const seat = input.seats.find((x) => x.id === s.seat);
    const winner = s.won;
    ctx.fillStyle = winner ? hexA(input.hue, 0.18) : hexA(t.panel2, 0.85);
    roundRect(ctx, 80, y, S - 160, 92, 16);
    ctx.fill();
    if (winner) {
      ctx.strokeStyle = input.hue;
      ctx.lineWidth = 3;
      roundRect(ctx, 80, y, S - 160, 92, 16);
      ctx.stroke();
    }
    ctx.fillStyle = t.ink;
    ctx.font = "600 38px Georgia, serif";
    ctx.fillText(seat?.name ?? `Seat ${s.seat + 1}`, 116, y + 58);
    ctx.font = "700 44px Georgia, serif";
    ctx.fillStyle = winner ? input.hue : t.ink;
    const label = String(s.total);
    ctx.fillText(label, S - 120 - ctx.measureText(label).width, y + 60);
    if (winner) {
      ctx.font = "20px Georgia, serif";
      ctx.fillStyle = input.hue;
      ctx.fillText("WINNER", 116, y + 84);
    }
    y += 108;
  }

  // footer
  ctx.font = "26px Georgia, serif";
  ctx.fillStyle = t.mut;
  ctx.letterSpacing = "4px";
  ctx.fillText(`${DOMAIN} · play the next one`, 80, S - 72);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not render card"))), "image/png")
  );
}

/** Share it natively where possible, download it where not. */
export async function shareResult(input: ShareCardInput): Promise<"shared" | "downloaded"> {
  const blob = await renderShareCard(input);
  const file = new File([blob], `gambit-${input.gameName.toLowerCase()}.png`, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: `${input.gameName} on ${BRAND}`,
      text: `We just finished a game of ${input.gameName}.`
    });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
