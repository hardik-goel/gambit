import type { Metadata, Viewport } from "next";
import { GambitProviders } from "@gambit/ui";
import { BRAND, PITCH, TAGLINE } from "@gambit/ui/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: `${BRAND} — ${TAGLINE}`,
  description: PITCH,
  applicationName: BRAND,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: BRAND, statusBarStyle: "black-translucent" },
  openGraph: { title: BRAND, description: PITCH, type: "website" }
};

export const viewport: Viewport = {
  themeColor: "#1a120c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <GambitProviders>
          <div className="gambit-room">{children}</div>
        </GambitProviders>
      </body>
    </html>
  );
}
