import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://startupmachine.ai"),
  title: {
    default: "Startup Machine — AI Startup Builder",
    template: "%s | Startup Machine",
  },
  description: "AI startup builder that generates decision-ready packets with market sizing, competitor analysis, and MVP scope.",
  applicationName: "Startup Machine",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
    apple: ["/favicon.svg"],
  },
  openGraph: {
    title: "Startup Machine — AI Startup Builder",
    description:
      "Go from idea to decision with AI-generated startup packets: market sizing, competitor analysis, MVP scope, and clear go/no-go recommendations.",
    url: "https://startupmachine.ai",
    siteName: "Startup Machine",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Startup Machine — AI Startup Builder",
    description:
      "Validate startup ideas with AI-generated decision packets and clear go/no-go recommendations.",
  },
};

const fontUrl =
  "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Sans:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const head = (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href={fontUrl} rel="stylesheet" />
    </>
  );

  if (!publishableKey) {
    return (
      <html lang="en">
        <head>{head}</head>
        <body>
          {children}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <html lang="en">
        <head>{head}</head>
        <body>
          {children}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
