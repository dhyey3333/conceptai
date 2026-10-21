import type { Metadata, Viewport } from "next";
import { Inter, Kalam } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// A handwriting face for the whiteboard; it includes Devanagari for Hindi labels.
const kalam = Kalam({ subsets: ["latin", "devanagari"], weight: ["300", "400", "700"], variable: "--font-kalam", display: "swap" });

export const metadata: Metadata = {
  title: "ConceptAI · Learn anything on a live whiteboard",
  description: "An AI teacher that explains any concept step by step on an interactive whiteboard, with voice, follow-up questions and exam-ready notes.",
};

export const viewport: Viewport = {
  themeColor: "#07090e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${kalam.variable}`}>
      <body className="bg-bg font-sans text-fg antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
