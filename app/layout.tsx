import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/components/theme/theme";
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The saved light / dark choice is rendered on the server (no pre-paint script); without one, CSS follows the OS.
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = saved === "light" || saved === "dark" ? saved : undefined;
  return (
    <html lang="en-IN" data-theme={theme} suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  );
}
