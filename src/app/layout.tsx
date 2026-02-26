import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://startupmachine.ai"),
  title: "Startup Machine",
  description: "AI startup builder that generates decision-ready packets with market sizing, competitor analysis, and MVP scope.",
  applicationName: "Startup Machine",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    shortcut: ["/favicon.svg"],
    apple: ["/favicon.svg"],
  },
  openGraph: {
    title: "Startup Machine | AI Startup Builder",
    description:
      "Go from idea to decision with AI-generated startup packets: market sizing, competitor analysis, MVP scope, and clear go/no-go recommendations.",
    url: "https://startupmachine.ai",
    siteName: "Startup Machine",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Startup Machine dashboard preview",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Startup Machine | AI Startup Builder",
    description:
      "Validate startup ideas with AI-generated decision packets and clear go/no-go recommendations.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return (
      <html lang="en">
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
        <body>
          {children}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
