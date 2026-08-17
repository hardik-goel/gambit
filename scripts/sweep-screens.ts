/**
 * Opens every screen and looks at it.
 *
 *   pnpm sweep                      # against a local dev server
 *   SWEEP_BASE=https://… pnpm sweep # against a deployment
 *
 * Nothing in this repository had ever been *seen*. Every check up to now was
 * headless in the other sense — assertions about state, never a rendered pixel.
 * This drives a real browser through the shelf, the lobby, all eleven felts,
 * the tutorial, the replay and the people panel, at a desktop width and a phone
 * width, and reports three kinds of thing:
 *
 *   * anything the page itself complained about (console errors, failed
 *     requests, unhandled rejections);
 *   * anything that is measurably wrong (horizontal overflow, controls smaller
 *     than a thumb, text against a background it cannot be read on);
 *   * a screenshot, so the rest can be judged by eye.
 *
 * Screenshots land in `.sweep/`, which is git-ignored.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";

const BASE = process.env.SWEEP_BASE ?? "http://127.0.0.1:3211";
const OUT = join(new URL("..", import.meta.url).pathname, ".sweep");

/** Every game the shelf offers, by the id its route uses. */
const GAMES = [
  "chess",
  "boxcar",
  "landfall",
  "quintet",
  "phantom",
  "motive",
  "hamlet",
  "mosaic",
  "facet",
  "stronghold",
  "remedy"
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 }
];

interface Finding {
  screen: string;
  viewport: string;
  kind: "console" | "network" | "overflow" | "target" | "empty" | "crash";
  detail: string;
}

let brokenServer = false;
const findings: Finding[] = [];
const note = (f: Finding): void => {
  findings.push(f);
  console.log(`  !! ${f.screen} [${f.viewport}] ${f.kind}: ${f.detail}`);
};

/** Console noise that is expected and says nothing about the product. */
const IGNORE = [
  /Download the React DevTools/,
  /\[Fast Refresh\]/,
  /Warning: Extra attributes from the server/,
  /favicon/i
];

function watch(page: Page, screen: string, viewport: string): void {
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    const text = message.text();
    if (IGNORE.some((r) => r.test(text))) return;
    note({ screen, viewport, kind: "console", detail: `${message.type()}: ${text.slice(0, 700)}` });
  });
  page.on("pageerror", (error) => {
    note({ screen, viewport, kind: "crash", detail: error.message.slice(0, 900) });
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (/ERR_ABORTED/.test(failure)) return; // navigation cancelled a fetch; not a fault
    note({ screen, viewport, kind: "network", detail: `${request.url().slice(0, 120)} ${failure}` });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    // The server's own build artefacts going missing is not a finding about
    // the product — it means the server is broken underneath us (building
    // while `next dev` runs will do it). Say so once, loudly, rather than
    // reporting several hundred consequences of it.
    if (response.url().includes("/_next/static/")) {
      if (!brokenServer) {
        brokenServer = true;
        console.error(
          "\nThe dev server is not serving its own assets — restart it before sweeping.\n"
        );
      }
      return;
    }
    if (response.url().includes("/api/social")) return; // polled before identity exists
    note({ screen, viewport, kind: "network", detail: `HTTP ${response.status()} ${response.url().slice(0, 120)}` });
  });
}

/** Things that can be measured rather than judged. */
async function measure(page: Page, screen: string, viewport: string): Promise<void> {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;

    // A control smaller than about 44px is hard to hit with a thumb.
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, a[href], input, select"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.width < 32 || box.height < 28) {
        const label = (el.textContent ?? "").trim().slice(0, 24) || el.getAttribute("aria-label") || el.tagName;
        small.push(`${label} (${Math.round(box.width)}×${Math.round(box.height)})`);
      }
    }

    // textContent, not innerText: innerText reports what is *laid out*, so a
    // long page clipped into a phone viewport looked empty when it was not.
    const text = (document.body.textContent ?? "").trim();
    return { overflow, small: small.slice(0, 6), textLength: text.length };
  });

  if (report.overflow > 2) {
    note({ screen, viewport, kind: "overflow", detail: `page scrolls sideways by ${report.overflow}px` });
  }
  if (viewport === "phone" && report.small.length) {
    note({ screen, viewport, kind: "target", detail: `small tap targets: ${report.small.join(", ")}` });
  }
  if (report.textLength < 40) {
    note({ screen, viewport, kind: "empty", detail: `only ${report.textLength} characters rendered` });
  }
}

async function shoot(page: Page, name: string, viewport: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}--${viewport}.png`), fullPage: false });
}

async function visit(
  browser: Browser,
  screen: string,
  path: string,
  viewport: (typeof VIEWPORTS)[number],
  after?: (page: Page) => Promise<void>
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  watch(page, screen, viewport.name);

  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (res && res.status() >= 400) {
      note({ screen, viewport: viewport.name, kind: "network", detail: `page returned HTTP ${res.status()}` });
    }
    await page.waitForTimeout(1200);
    if (after) await after(page);
    await page.waitForTimeout(600);
    await measure(page, screen, viewport.name);
    await shoot(page, screen, viewport.name);
  } catch (e) {
    note({
      screen,
      viewport: viewport.name,
      kind: "crash",
      detail: e instanceof Error ? e.message.split("\n")[0]!.slice(0, 180) : String(e)
    });
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  console.log(`sweeping ${BASE}\n`);

  // Somebody else's dev server answering on the port we expected is not a
  // hypothetical: it happened, and an entire sweep was photographed before
  // anyone noticed it was a different product. Check whose door this is first.
  const front = await fetch(BASE).then((r) => r.text()).catch(() => "");
  if (!/gambit/i.test(front)) {
    throw new Error(
      `${BASE} is serving something that is not Gambit — check what is bound to that port`
    );
  }

  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS) {
      console.log(`— ${viewport.name} (${viewport.width}×${viewport.height})`);

      await visit(browser, "shelf", "/", viewport);
      await visit(browser, "learn", "/learn", viewport);

      for (const game of GAMES) {
        await visit(browser, `learn-${game}`, `/learn/${game}`, viewport);
      }

      // A table of one's own. Pressing "play here" only opens the invite card,
      // so the felt — the thing the whole product is for — was never once
      // photographed until this walked the rest of the way: into the lobby,
      // fill the empty seats with bots, and deal.
      for (const game of GAMES) {
        await visit(browser, `table-${game}`, `/?game=${game}`, viewport, async (page) => {
          const play = page.getByRole("button", { name: /play here/i }).first();
          if (!(await play.count())) return;
          await play.click({ timeout: 10_000 }).catch(() => undefined);

          const open = page.getByRole("button", { name: /open the lobby/i }).first();
          await open.click({ timeout: 10_000 }).catch(() => undefined);
          await page.waitForURL(/\/r\//, { timeout: 15_000 }).catch(() => undefined);
          await page.waitForTimeout(1500);

          // Seat bots until the table is full enough to deal.
          for (let i = 0; i < 5; i++) {
            const start = page.getByRole("button", { name: /start the game/i }).first();
            if ((await start.count()) && (await start.isEnabled().catch(() => false))) break;
            const bot = page.getByRole("button", { name: /add a bot/i }).first();
            if (!(await bot.count())) break;
            await bot.click({ timeout: 5_000 }).catch(() => undefined);
            await page.waitForTimeout(700);
          }

          const start = page.getByRole("button", { name: /start the game/i }).first();
          if (await start.count()) {
            await start.click({ timeout: 8_000 }).catch(() => undefined);
            await page.waitForTimeout(3500);
          }
        });
      }

      await visit(browser, "people", "/", viewport, async (page) => {
        const people = page.getByRole("button", { name: /people|friends/i }).first();
        if (await people.count()) {
          await people.click({ timeout: 5_000 }).catch(() => undefined);
          await page.waitForTimeout(800);
        }
      });
    }
  } finally {
    await browser.close();
  }

  writeFileSync(join(OUT, "findings.json"), JSON.stringify(findings, null, 2));
  console.log(`\nscreenshots and findings.json in .sweep/`);
  if (brokenServer) {
    console.error("this run is not trustworthy: the server was not serving its own assets");
    process.exit(1);
  }
  const byKind = new Map<string, number>();
  for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  if (!findings.length) {
    console.log("no automatic findings — the rest is a matter of looking");
    return;
  }
  console.log(`\n${findings.length} findings:`);
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${kind}`);
  }
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
