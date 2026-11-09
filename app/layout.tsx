import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { PrefsProvider } from "@/components/prefs-provider";

export const metadata: Metadata = {
  title: "PULSE.DEV — il polso della tecnologia",
  description:
    "Hacker News, Lobsters e Reddit in un unico feed: il meglio di oggi e le pietre miliari di ieri.",
};

export const viewport: Viewport = {
  themeColor: "#050507",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it" className={GeistSans.variable}>
      <body>
        {/* Senza JS le card non possono essere animate: vanno mostrate subito. */}
        <noscript>
          <style>{"[data-reveal]{opacity:1!important}"}</style>
        </noscript>
        <PrefsProvider>{children}</PrefsProvider>
      </body>
    </html>
  );
}
