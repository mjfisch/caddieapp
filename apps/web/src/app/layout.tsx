import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import BottomNav from "./_nav/BottomNav";

const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GAI Caddie",
  description: "AI-authored golf yardage book — the strokes-gained engine, in your pocket.",
  manifest: "/site.webmanifest",
  applicationName: "GAI Caddie",
  icons: {
    icon: [
      { url: "/gai-caddie-favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/favicon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#070d18",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
