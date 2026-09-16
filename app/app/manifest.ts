import type { MetadataRoute } from "next";

/**
 * Makes the desk installable to a phone's home screen.
 *
 * Deliberately NOT a capture surface. Capture lives in Telegram because it has to reach Josh —
 * raising waiting candidates (4.3.4), silence alerts (13.1), a draft being ready — and web push on
 * iOS is not dependable enough to carry that.
 *
 * The weekly pass has the opposite shape: he opens it on purpose, once a week (clause 11, step 07).
 * That needs no notifications at all, so an installed web app gives the whole benefit — a home
 * screen icon, full screen, no browser chrome — with none of the App Store cost.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The desk",
    short_name: "The desk",
    description: "The idea bank and the drafts written from it.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f0f1ee",
    theme_color: "#f0f1ee",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
