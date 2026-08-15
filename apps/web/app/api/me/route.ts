import { NextResponse } from "next/server";
import { requireIdentity, setName } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await requireIdentity();
  return NextResponse.json(me);
}

export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string };
  if (body.name) await setName(body.name);
  const me = await requireIdentity();
  return NextResponse.json(me);
}
