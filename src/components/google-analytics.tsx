import Script from "next/script";
import { getGoogleAnalyticsMeasurementId } from "@/lib/google-analytics";

export function GoogleAnalytics() {
  const measurementId = getGoogleAnalyticsMeasurementId(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  );

  return (
    <>
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: [
            "(function(){",
            "var dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.doNotTrack === 'yes';",
            "if (dnt) return;",
            "window.dataLayer = window.dataLayer || [];",
            "window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};",
            "window.gtag('js', new Date());",
            "window.gtag('config', '" + measurementId + "', {",
            "anonymize_ip: true,",
            "allow_google_signals: false,",
            "allow_ad_personalization_signals: false",
            "});",
            "var script = document.createElement('script');",
            "script.async = true;",
            "script.src = 'https://www.googletagmanager.com/gtag/js?id=" + measurementId + "';",
            "document.head.appendChild(script);",
            "})();",
          ].join("\n"),
        }}
      />
    </>
  );
}
