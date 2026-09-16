import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { CommandPalette } from "./command-palette";

export const metadata: Metadata = {
  title: "The desk",
  description: "The idea bank and the drafts written from it.",
  appleWebApp: {
    capable: true,
    title: "The desk",
    // Matches the paper ground, so the status bar does not sit on a mismatched strip.
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom stays enabled. Josh reads prose here and may want to pinch in; disabling it to make an app
  // feel "native" trades a real accessibility need for a cosmetic one.
  maximumScale: 5,
  // One colour, because the app is one theme. Declaring a dark variant here would paint the phone's
  // status bar black above a white page.
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <h1><Link href="/">The desk</Link></h1>
          <nav aria-label="Sections">
            <Link href="/drafts">Drafts</Link>
            <Link href="/bank">Idea bank</Link>
          </nav>
          <CommandPalette />
        </header>
        {children}
      </body>
    </html>
  );
}
