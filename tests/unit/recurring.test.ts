import { describe, expect, it } from "vitest";
import { computeNextRunAt, validateRecurringCron } from "@/lib/recurring";

describe("recurring cron helper", () => {
  it("validates supported cron expressions", () => {
    expect(validateRecurringCron("*/5 * * * *")).toBe(true);
    expect(validateRecurringCron("15 * * * *")).toBe(true);
    expect(validateRecurringCron("0 6 * * *")).toBe(true);
    expect(validateRecurringCron("0 6 * * 1")).toBe(false);
  });

  it("computes next time for every N minutes", () => {
    const now = new Date("2026-03-01T12:03:45Z");
    const next = computeNextRunAt({ cronExpr: "*/5 * * * *", from: now });
    expect(next.toISOString()).toBe("2026-03-01T12:08:00.000Z");
  });

  it("computes next time for daily schedule", () => {
    const now = new Date("2026-03-01T07:00:00Z");
    const next = computeNextRunAt({ cronExpr: "0 6 * * *", from: now });
    expect(next.toISOString()).toBe("2026-03-02T06:00:00.000Z");
  });
});
