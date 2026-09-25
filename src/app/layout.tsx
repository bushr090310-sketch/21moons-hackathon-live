import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { LiveProvider } from "@/components/live";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: { default: "21MOONS — Live", template: "%s · 21MOONS" },
  description: "21MOONS Hackathon live game control system — Malmö, 26 September 2026.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#04050a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Public (anon) Supabase credentials for Realtime are read at request time.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <LiveProvider realtime={url && key ? { url, key } : null}>
          <ToastProvider>
            <div className="relative z-10">{children}</div>
          </ToastProvider>
        </LiveProvider>
      </body>
    </html>
  );
}
