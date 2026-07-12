import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/resources/"],
      disallow: [
        "/api/",
        "/batches/",
        "/board/",
        "/bulk-import/",
        "/chat/",
        "/dashboard/",
        "/inbox/",
        "/plan-review/",
        "/projects/",
        "/settings/",
        "/sign-in/",
        "/sign-up/",
        "/tasks/",
      ],
    },
    sitemap: "https://startupmachine.ai/sitemap.xml",
    host: "https://startupmachine.ai",
  };
}
