import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FounderResourceFooter, FounderResourceHeader } from "@/components/founder-resource-shell";
import { founderResources, getFounderResource, type ResourceBlock } from "@/lib/founder-resources";

import styles from "../resources.module.css";

type ResourcePageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return founderResources.map((resource) => ({ slug: resource.slug }));
}

export async function generateMetadata({ params }: ResourcePageProps): Promise<Metadata> {
  const { slug } = await params;
  const resource = getFounderResource(slug);

  if (!resource) {
    return {};
  }

  const canonicalPath = `/resources/${resource.slug}`;

  return {
    title: resource.title,
    description: resource.description,
    keywords: [resource.primaryKeyword, "startup planning", "founder resources"],
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: resource.title,
      description: resource.description,
      url: canonicalPath,
      type: "article",
      publishedTime: resource.updatedAt,
      modifiedTime: resource.updatedAt,
      authors: ["Startup Machine"],
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Startup Machine" }],
    },
    twitter: {
      card: "summary_large_image",
      title: resource.title,
      description: resource.description,
      images: ["/og-image.png"],
    },
  };
}

function ResourceBlockView({ block }: { block: ResourceBlock }) {
  if (block.type === "html") {
    return <div className={styles.editorialBody} dangerouslySetInnerHTML={{ __html: block.html }} />;
  }

  if (block.type === "paragraph") {
    return <p>{block.text}</p>;
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ListTag>
    );
  }

  if (block.type === "table") {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {block.table.headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row) => (
              <tr key={row.join("|")}>
                {row.map((cell, index) =>
                  index === 0 ? (
                    <td key={cell}>
                      <strong>{cell}</strong>
                    </td>
                  ) : (
                    <td key={cell}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "callout") {
    return (
      <aside className={styles.callout}>
        <strong>{block.title}</strong>
        <p>{block.text}</p>
      </aside>
    );
  }

  return (
    <div className={styles.template}>
      <strong className={styles.templateTitle}>{block.title}</strong>
      <div className={styles.templateLines}>
        {block.lines.map((line) => (
          <div key={line} className={styles.templateLine}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function FounderResourcePage({ params }: ResourcePageProps) {
  const { slug } = await params;
  const resource = getFounderResource(slug);

  if (!resource) {
    notFound();
  }

  const related = founderResources.filter((item) => item.slug !== resource.slug).slice(0, 3);
  const articleUrl = `https://startupmachine.ai/resources/${resource.slug}`;
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: resource.title,
      description: resource.description,
      datePublished: resource.updatedAt,
      dateModified: resource.updatedAt,
      mainEntityOfPage: articleUrl,
      author: { "@type": "Organization", name: "Startup Machine", url: "https://startupmachine.ai" },
      publisher: { "@type": "Organization", name: "Startup Machine", url: "https://startupmachine.ai" },
      keywords: [resource.primaryKeyword, "startup planning", "founder resources"],
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://startupmachine.ai" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Founder Resources",
          item: "https://startupmachine.ai/resources",
        },
        { "@type": "ListItem", position: 3, name: resource.title, item: articleUrl },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: resource.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ];

  return (
    <main className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <FounderResourceHeader />

      <header className={styles.articleHero}>
        <p className={styles.eyebrow}>{resource.eyebrow}</p>
        <h1>{resource.title}</h1>
        <p className={styles.lede}>{resource.description}</p>
        <div className={styles.articleMeta}>
          <span>{resource.readingMinutes} minute read</span>
          <span>Updated {new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${resource.updatedAt}T00:00:00Z`))}</span>
          <span>Includes a working template</span>
        </div>
      </header>

      <div className={styles.articleLayout}>
        <nav className={styles.toc} aria-label="On this page">
          <div className={styles.tocTitle}>On this page</div>
          <ol>
            {resource.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className={styles.article}>
          {resource.sections.map((section) => (
            <section key={section.id} id={section.id} className={styles.articleSection}>
              <h2>{section.title}</h2>
              {section.blocks.map((block, index) => (
                <ResourceBlockView key={`${section.id}-${block.type}-${index}`} block={block} />
              ))}
            </section>
          ))}

          <section className={styles.faq} aria-labelledby="faq-heading">
            <h2 id="faq-heading">Frequently asked questions</h2>
            {resource.faqs.map((faq) => (
              <div key={faq.question} className={styles.faqItem}>
                <h3>{faq.question}</h3>
                <p>{faq.answer}</p>
              </div>
            ))}
          </section>

          <aside className={styles.guideCta}>
            <p>
              Startup Machine turns an idea, domain, or repo into a sourced founder brief with market context,
              key risks, and a clear next test.
            </p>
            <Link href="/onboarding?new=1">Preview my founder brief →</Link>
          </aside>
        </article>
      </div>

      <section className={styles.related} aria-labelledby="related-heading">
        <h2 id="related-heading">Keep making the decision</h2>
        <div className={styles.relatedList}>
          {related.map((item) => (
            <Link key={item.slug} href={`/resources/${item.slug}`} className={styles.relatedLink}>
              {item.shortTitle} →
            </Link>
          ))}
        </div>
      </section>

      <FounderResourceFooter />
    </main>
  );
}
