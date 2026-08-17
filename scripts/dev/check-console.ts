/** Loads one screen and reports what the console said. */
import { chromium } from "playwright";

async function main(): Promise<void> {
  const path = process.argv[2] ?? "/";
  const base = process.env.SWEEP_BASE ?? "http://127.0.0.1:3211";
  const browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: "reduce" } as never);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await browser.close();
  console.log(errors.length ? `${errors.length} console errors:` : "no console errors");
  const counts = new Map<string, number>();
  for (const e of errors) counts.set(e, (counts.get(e) ?? 0) + 1);
  for (const [text, n] of counts) console.log(`  ${n}x ${text}`);
}

void main().catch((e: unknown) => { console.error(e); process.exit(1); });
