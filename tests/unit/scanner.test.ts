import { describe, it, expect } from "vitest";
import { scanResultSchema } from "@/types/domain";

describe("scan schema", () => {
  it("validates a site scan", () => {
    const parsed = scanResultSchema.parse({
      dns: "live",
      http_status: 200,
      tech_stack: ["Next.js"],
      meta: { title: "A", desc: "B", og_image: null },
      existing_content: "site",
      competitors_found: [],
    });
    expect(parsed.dns).toBe("live");
  });
});
