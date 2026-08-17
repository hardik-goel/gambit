/** Presses "Play the computer" and confirms a dealt table appears. */
import { chromium } from "playwright";

async function main(): Promise<void> {
  const base = process.env.SMOKE_BASE ?? "http://127.0.0.1:3211";
  const games = (process.env.SMOKE_GAMES ?? "chess,boxcar,landfall,remedy,mosaic").split(",");
  const browser = await chromium.launch();
  let failed = 0;

  for (const game of games) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${base}/?game=${game}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: /play the computer/i }).first().click({ timeout: 10_000 });
      await page.waitForURL(/\/r\/[A-Z0-9]{6}/, { timeout: 20_000 });
      await page.waitForTimeout(3000);

      // A dealt table has no lobby controls left on it.
      const stillLobby = await page.getByRole("button", { name: /start the game/i }).count();
      const text = (await page.locator("body").innerText()).slice(0, 4000);
      const dealt = stillLobby === 0;
      console.log(`  ${dealt ? "ok  " : "FAIL"}  ${game} — ${page.url().split("/r/")[1]}${dealt ? "" : " still in the lobby"}`);
      if (!dealt) failed++;
      void text;
    } catch (e) {
      console.log(`  FAIL  ${game} — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      failed++;
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.log(`\n${games.length - failed}/${games.length} went straight to a dealt table`);
  if (failed) process.exit(1);
}

void main().catch((e: unknown) => { console.error(e); process.exit(1); });
