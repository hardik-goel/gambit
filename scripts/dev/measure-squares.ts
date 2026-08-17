/** Are the squares square? */
import { chromium } from "playwright";

async function main(): Promise<void> {
  const base = process.env.SWEEP_BASE ?? "http://127.0.0.1:3211";
  const browser = await chromium.launch();
  for (const [path, selector] of [
    ["/learn/chess", '[aria-label="Chess board"] > *'],
    ["/learn/quintet", '[aria-label="Quintet board"] > *']
  ] as const) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const sizes = await page.evaluate((sel) => {
      const boxes = Array.from(document.querySelectorAll(sel)).map((el) => {
        const b = el.getBoundingClientRect();
        return `${Math.round(b.width)}x${Math.round(b.height)}`;
      });
      return Array.from(new Set(boxes));
    }, selector);
    console.log(`${path}: ${sizes.slice(0, 6).join(", ")}${sizes.length > 6 ? ` (+${sizes.length - 6} more)` : ""}`);
    await context.close();
  }
  await browser.close();
}

void main().catch((e: unknown) => { console.error(e); process.exit(1); });
