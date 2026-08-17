/** Names the element that is making a page scroll sideways. */
import { chromium } from "playwright";

async function main(): Promise<void> {
  const path = process.argv[2] ?? "/";
  const base = process.env.SWEEP_BASE ?? "http://127.0.0.1:3211";
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const culprits = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const box = el.getBoundingClientRect();
      if (box.right <= limit + 1) continue;
      const tag = el.tagName.toLowerCase();
      const text = (el.textContent ?? "").trim().slice(0, 28);
      const chain: string[] = [];
      let node: Element | null = el;
      while (node && chain.length < 6) {
        const b = node.getBoundingClientRect();
        chain.push(`${node.tagName.toLowerCase()}(${Math.round(b.width)})`);
        node = node.parentElement;
      }
      out.push(
        `${tag} right=${Math.round(box.right)} width=${Math.round(box.width)} — "${text}" :: ${chain.join(" < ")}`
      );
    }
    return { limit, out: out.slice(0, 12) };
  });

  console.log(`viewport ${culprits.limit}px; ${culprits.out.length} elements past the edge`);
  for (const line of culprits.out) console.log(`  ${line}`);
  await browser.close();
}

void main().catch((e: unknown) => { console.error(e); process.exit(1); });
