/** Loads a live table repeatedly and counts hydration complaints. */
import { chromium } from "playwright";

async function main(): Promise<void> {
  const base = process.env.SMOKE_BASE ?? "https://gambit-swart.vercel.app";
  const gameId = process.env.SMOKE_GAME ?? "landfall";
  const rounds = Number(process.env.ROUNDS ?? 6);
  const browser = await chromium.launch();
  let mismatches = 0;

  for (let i = 0; i < rounds; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));

    // A table of our own, with bots in the other chairs and a game under way.
    const made = await page.request.post(`${base}/api/rooms`, { data: { gameId } });
    const room = (await made.json()) as { room: { id: string; code: string } };
    await page.request.post(`${base}/api/rooms/${room.room.id}/action`, { data: { action: "fill" } });
    await page.request.post(`${base}/api/rooms/${room.room.id}/action`, {
      data: { action: "ready", ready: true }
    });
    await page.request.post(`${base}/api/rooms/${room.room.id}/action`, { data: { action: "start" } });

    await page.goto(`${base}/r/${room.room.code}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);

    const bad = errors.filter((e) => /418|423|425|hydrat/i.test(e));
    if (bad.length) {
      mismatches++;
      console.log(`  round ${i + 1}: ${bad[0]!.slice(0, 120)}`);
    } else {
      console.log(`  round ${i + 1}: clean`);
    }
    await context.close();
  }

  await browser.close();
  console.log(`\n${mismatches}/${rounds} rounds showed a hydration mismatch`);
  if (mismatches) process.exit(1);
}

void main().catch((e: unknown) => { console.error(e); process.exit(1); });
