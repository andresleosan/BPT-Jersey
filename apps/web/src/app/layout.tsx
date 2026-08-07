import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Source_Sans_3 } from "next/font/google";

import "./globals.css";

const displayFont = Barlow_Condensed({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const bodyFont = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: {
    default: "BPT Jersey | Brazilian Jiu-Jitsu Academy",
    template: "%s | BPT Jersey",
  },
  description:
    "Train Brazilian Jiu-Jitsu with Brazilian Power Team Jersey and manage every academy touchpoint in one clear place.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#2F2483",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
