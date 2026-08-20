import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

  it("guards the browser loader when Do Not Track is enabled", async () => {
    const source = await readFile(
      resolve(__dirname, "../../src/components/google-analytics.tsx"),
      "utf8",
    );
    expect(source).toMatch(/doNotTrack/);
    expect(source).toMatch(/if\s*\(dnt\)\s*return/);
  });
});
