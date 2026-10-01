import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "@/components/theme/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claimix — Health insurance & hospital claims",
  description: "Verify eligibility, understand coverage, and manage pre-authorizations, documents and claims in one place.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9f2f5" },
    { media: "(prefers-color-scheme: dark)", color: "#131d27" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
