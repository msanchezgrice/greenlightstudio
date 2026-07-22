import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { PostHogIdentity } from "@/components/posthog-identity";

export const metadata: Metadata = {
  metadataBase: new URL("https://startupmachine.ai"),
  title: {
    default: "Startup Machine — AI Startup Builder",
    template: "%s | Startup Machine",
  },
  description: "AI startup builder that generates decision-ready packets with market sizing, competitor analysis, and MVP scope.",
  alternates: { canonical: "/" },
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
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Startup Machine — AI Startup Builder",
    description:
      "Validate startup ideas with AI-generated decision packets and clear go/no-go recommendations.",
    images: ["/og-image.png"],
  },
};

const fontUrl =
  "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&family=IBM+Plex+Sans:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap";

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Startup Machine",
    url: "https://startupmachine.ai",
    logo: "https://startupmachine.ai/og-image.png",
    email: "msanchezgrice@gmail.com",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Startup Machine",
    url: "https://startupmachine.ai",
    description:
      "AI startup builder that generates decision-ready packets with market sizing, competitor analysis, and MVP scope.",
    publisher: { "@type": "Organization", name: "Startup Machine", url: "https://startupmachine.ai" },
  },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const themeBootScript = `(function(){try{var t=localStorage.getItem("sm_theme")==="light"?"light":"dark";document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==="light"?"light":"dark";}catch(_){document.documentElement.dataset.theme="dark";document.documentElement.style.colorScheme="dark";}})();`;

  const head = (
    <>
      <script
        src="https://analytics.ahrefs.com/analytics.js"
        data-key="sfC2zlgd9jKEVrN227+mog"
        async
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href={fontUrl} rel="stylesheet" />
      <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
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
          <PostHogIdentity />
          {children}
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
