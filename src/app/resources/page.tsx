import type { Metadata } from "next";
import Link from "next/link";

import { FounderResourceFooter, FounderResourceHeader } from "@/components/founder-resource-shell";
import { founderResources } from "@/lib/founder-resources";

import styles from "./resources.module.css";

export const metadata: Metadata = {
  title: "Founder Resources: Validate, Plan, and Build Your Startup",
  description:
    "Practical startup guides and founder templates for idea validation, MVP planning, AI startup tools, and focused execution.",
  alternates: { canonical: "/resources" },
  openGraph: {
    title: "Founder Resources | Startup Machine",
    description:
      "Field guides and working templates for startup idea validation, MVP planning, and founder execution.",
    url: "/resources",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Startup Machine" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Founder Resources | Startup Machine",
    description: "Practical field guides for making better startup decisions.",
    images: ["/og-image.png"],
  },
};

export default function FounderResourcesPage() {
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Startup Machine founder resources",
    itemListElement: founderResources.map((resource, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: resource.title,
      url: `https://startupmachine.ai/resources/${resource.slug}`,
    })),
  };

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList).replace(/</g, "\\u003c") }}
      />
      <FounderResourceHeader />

      <section className={styles.indexHero}>
        <p className={styles.eyebrow}>Startup Machine / Founder Resources</p>
        <h1>
          Fewer opinions.
          <br />
          Better <span className={styles.heroAccent}>decisions.</span>
        </h1>
        <p className={styles.lede}>
          Field-tested frameworks for validating an idea, scoping the right MVP, choosing AI startup tools,
          and running a focused month of founder work.
        </p>
      </section>

      <section className={styles.library} aria-labelledby="library-heading">
        <div className={styles.libraryIntro}>
          <strong id="library-heading">The decision library</strong>
          <span>
            Each guide ends in a concrete artifact: a scorecard, a plan, an evaluation rubric, or a decision
            log you can use immediately.
          </span>
        </div>
        <div className={styles.resourceList}>
          {founderResources.map((resource, index) => (
            <Link key={resource.slug} href={`/resources/${resource.slug}`} className={styles.resourceRow}>
              <span className={styles.resourceNumber}>{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.resourceCopy}>
                <h2>{resource.title}</h2>
                <p>{resource.description}</p>
              </span>
              <span className={styles.resourceIntent}>
                {resource.eyebrow}
                <br />
                {resource.readingMinutes} min read
              </span>
              <span className={styles.resourceArrow} aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <FounderResourceFooter />
    </main>
  );
}
