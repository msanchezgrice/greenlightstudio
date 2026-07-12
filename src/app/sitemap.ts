import type { MetadataRoute } from "next";

import { founderResources } from "@/lib/founder-resources";

const siteUrl = "https://startupmachine.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: new Date("2026-07-12"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${siteUrl}/resources`,
      lastModified: new Date("2026-07-12"),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...founderResources.map((resource) => ({
      url: `${siteUrl}/resources/${resource.slug}`,
      lastModified: new Date(resource.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
