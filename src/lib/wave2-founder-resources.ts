import rawPosts from "../../content/editorial/wave2-content.json";
import type { FounderResource } from "./founder-resources";

type WaveTwoPost = {
  slug: string; title: string; description: string; job: string; pillar: boolean;
  tags: string[]; bodyHtml: string; readingMinutes: number; updatedAt: string;
};

export const wave2FounderResources: FounderResource[] = (rawPosts as WaveTwoPost[]).map((post) => ({
  slug: post.slug,
  title: post.title,
  shortTitle: post.title,
  description: post.description,
  eyebrow: post.pillar ? "2,000+ word founder workbook" : "Evidence-led founder guide",
  readingMinutes: post.readingMinutes,
  primaryKeyword: post.tags[0] ?? post.job,
  updatedAt: post.updatedAt,
  sections: [{ id: "guide", title: "A practical, evidence-led workflow", blocks: [{ type: "html", html: post.bodyHtml }] }],
  faqs: [
    { question: "How should I use this guide?", answer: "Write the decision first, preserve the evidence and limitations, run the smallest credible test, and record the next action." },
    { question: "Is this a substitute for professional advice?", answer: "No. Verify legal, financial, safety, regulatory, and technical questions with a qualified professional for the real situation." },
  ],
}));
