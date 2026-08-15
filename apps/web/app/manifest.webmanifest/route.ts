import { NextResponse } from "next/server";
import { BRAND, PITCH, TAGLINE } from "@gambit/ui/brand";

export const runtime = "nodejs";

/** Installable from the first visit — a table you keep on the home screen. */
export function GET() {
  return NextResponse.json({
    name: `${BRAND} — ${TAGLINE}`,
    short_name: BRAND,
    description: PITCH,
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#1a120c",
    theme_color: "#1a120c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
    ]
  });
}
