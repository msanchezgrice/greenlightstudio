import Script from "next/script";
import { getGoogleAnalyticsMeasurementId } from "@/lib/google-analytics";

export function GoogleAnalytics() {
  const measurementId = getGoogleAnalyticsMeasurementId(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  );

  return (
    <>
      <Script
        src={"https://www.googletagmanager.com/gtag/js?id=" + measurementId}
        strategy="afterInteractive"
      />
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: [
            "window.dataLayer = window.dataLayer || [];",
            "function gtag(){dataLayer.push(arguments);}",
            "gtag('js', new Date());",
            "gtag('config', '" + measurementId + "', {",
            "anonymize_ip: true,",
            "allow_google_signals: false,",
            "allow_ad_personalization_signals: false",
            "});",
          ].join("\n"),
        }}
      />
    </>
  );
}
