import { chromium } from "playwright";
async function main(): Promise<void> {
  const base = process.env.SHOT_BASE ?? "http://127.0.0.1:3211";
  const map = process.env.SHOT_MAP ?? "meridian";
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 1000 } } as never);
  const made = await page.request.post(`${base}/api/rooms`, { data: { gameId: "boxcar" } });
  const room = (await made.json()) as { room: { id: string; code: string } };
  await page.request.post(`${base}/api/rooms/${room.room.id}/action`, {
    data: { action: "config", config: { map } }
  });
  await page.request.post(`${base}/api/rooms/${room.room.id}/action`, { data: { action: "fill" } });
  await page.request.post(`${base}/api/rooms/${room.room.id}/action`, { data: { action: "ready", ready: true } });
  await page.request.post(`${base}/api/rooms/${room.room.id}/action`, { data: { action: "start" } });
  await page.goto(`${base}/r/${room.room.code}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // The deal plays an intro card over the felt; skip it to photograph the map.
  await page.mouse.click(640, 500);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `.sweep/map-${map}.png` });
  await b.close();
  console.log(`shot ${map}`);
}
void main();
