import { NextResponse } from "next/server";
import { track, type AnalyticsEvent } from "@gambit/core";
import { rateLimit } from "@/lib/server/rateLimit";
import { readIdentity } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The client's analytics events come here and go into the same sink the server
 * uses. Nothing is stored per person: the payloads carry a game id and a
 * number, and that is all they are allowed to carry.
 */
export async function POST(req: Request) {
  const me = await readIdentity();
  if (!rateLimit(`analytics:${me?.playerId ?? "anon"}`, 60, 60_000)) {
    return NextResponse.json({ ok: true });
  }
  try {
    const event = (await req.json()) as AnalyticsEvent;
    if (typeof event?.name === "string") track(event);
  } catch {
    // A malformed beacon is not worth a 400.
  }
  return NextResponse.json({ ok: true });
}
