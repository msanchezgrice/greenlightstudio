import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOOGLE_ANALYTICS_MEASUREMENT_ID,
  getGoogleAnalyticsMeasurementId,
} from "@/lib/google-analytics";

describe("Google Analytics configuration", () => {
  it("uses the canonical Startup Machine measurement ID when env is absent", () => {
    expect(getGoogleAnalyticsMeasurementId(undefined)).toBe(
      DEFAULT_GOOGLE_ANALYTICS_MEASUREMENT_ID,
    );
  });

  it("accepts a valid public override and rejects malformed values", () => {
    expect(getGoogleAnalyticsMeasurementId(" G-OVERRIDE123 ")).toBe("G-OVERRIDE123");
    expect(getGoogleAnalyticsMeasurementId("not-a-measurement-id")).toBe(
      DEFAULT_GOOGLE_ANALYTICS_MEASUREMENT_ID,
    );
  });
});
