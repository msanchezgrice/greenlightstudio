"use client";

import { useState } from "react";
import { track } from "@vercel/analytics";
import styles from "@/app/landing.module.css";
import { TrackedLinkButton } from "@/components/tracked-link-button";

const proofCases = [
  {
    id: "idea",
    label: "Idea Input",
    founderInput: {
      title: "Founder input",
      lines: [
        "Idea: AI tool for compliance teams that turns scattered vendor questionnaires into reusable evidence packs.",
        "Problem: Security reviews are slow, repetitive, and painful for lean teams.",
        "Goal: Know if this is worth a serious validation sprint.",
      ],
    },
    brief: {
      recommendation: "Revise",
      confidence: 71,
      headline: "Sharp pain point, but the wedge needs to be narrower than generic compliance automation.",
      risk: "Crowded category unless the ICP is clearly limited to fast-growing B2B teams with repeat questionnaires.",
      opportunity: "Strong pull if positioned around response speed and reusable trust assets instead of broad GRC.",
      competitors: ["Vanta", "Drata", "Secureframe"],
    },
  },
  {
    id: "domain",
    label: "Domain Scan",
    founderInput: {
      title: "Scanned signal",
      lines: [
        "Domain: trailsense.app",
        "Site status: live landing page with waitlist copy and social preview image.",
        "Repo: none connected yet.",
      ],
    },
    brief: {
      recommendation: "Greenlight",
      confidence: 83,
      headline: "Existing demand signal plus a live site is enough to justify a full founder brief immediately.",
      risk: "Differentiation must be stronger than generic trip-planning or habit-tracking tools.",
      opportunity: "Live site copy and audience clues make competitor teardown and positioning analysis much faster.",
      competitors: ["AllTrails", "Komoot", "Gaia GPS"],
    },
  },
];

function badgeLabel(recommendation: string) {
  if (recommendation === "Greenlight") return styles.showcaseBadgeGreen;
  if (recommendation === "Revise") return styles.showcaseBadgeAmber;
  return styles.showcaseBadgeSlate;
}

export function LandingProofSection() {
  const [activeId, setActiveId] = useState(proofCases[0].id);
  const activeCase = proofCases.find((entry) => entry.id === activeId) ?? proofCases[0];

  return (
    <section className={styles.showcaseSection} id="proof">
      <div className={styles.sectionLabel}>Proof</div>
      <div className={styles.sectionTitle}>See the brief before you commit</div>
      <div className={styles.sectionSub}>
        The first session should feel like a founder review, not a blank form. This is the kind of instant read the onboarding flow now surfaces before signup.
      </div>

      <div className={styles.showcaseTabs}>
        {proofCases.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`${styles.showcaseTab} ${entry.id === activeCase.id ? styles.showcaseTabActive : ""}`}
            onClick={() => {
              setActiveId(entry.id);
              track("landing_proof_case_selected", { case_id: entry.id });
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className={styles.showcaseGrid}>
        <div className={styles.showcasePanel}>
          <div className={styles.showcaseEyebrow}>{activeCase.founderInput.title}</div>
          <div className={styles.showcaseCardTitle}>What the founder starts with</div>
          <div className={styles.showcaseList}>
            {activeCase.founderInput.lines.map((line) => (
              <div key={line} className={styles.showcaseListItem}>
                {line}
              </div>
            ))}
          </div>
        </div>

        <div className={`${styles.showcasePanel} ${styles.showcasePanelBright}`}>
          <div className={styles.showcaseTopRow}>
            <div>
              <div className={styles.showcaseEyebrow}>Instant brief</div>
              <div className={styles.showcaseCardTitle}>What Startup Machine returns</div>
            </div>
            <div className={`${styles.showcaseBadge} ${badgeLabel(activeCase.brief.recommendation)}`}>
              {activeCase.brief.recommendation} · {activeCase.brief.confidence}
            </div>
          </div>
          <div className={styles.showcaseHeadline}>{activeCase.brief.headline}</div>
          <div className={styles.showcaseInsightGrid}>
            <div className={styles.showcaseInsight}>
              <span>Key risk</span>
              <strong>{activeCase.brief.risk}</strong>
            </div>
            <div className={styles.showcaseInsight}>
              <span>Upside</span>
              <strong>{activeCase.brief.opportunity}</strong>
            </div>
          </div>
          <div className={styles.showcaseCompetitors}>
            {activeCase.brief.competitors.map((competitor) => (
              <span key={competitor} className={styles.showcaseCompetitorChip}>
                {competitor}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.proofStats}>
        <div className={styles.proofStat}>
          <div className={styles.proofStatNum}>1</div>
          <div className={styles.proofStatLabel}>clear recommendation before account creation</div>
        </div>
        <div className={styles.proofStat}>
          <div className={styles.proofStatNum}>3</div>
          <div className={styles.proofStatLabel}>competitor cues surfaced in the first review</div>
        </div>
        <div className={styles.proofStat}>
          <div className={styles.proofStatNum}>0</div>
          <div className={styles.proofStatLabel}>setup steps required to see initial value</div>
        </div>
      </div>

      <div className={styles.showcaseCtaRow}>
        <TrackedLinkButton
          href="/onboarding?new=1"
          className={styles.btnPrimary}
          eventName="landing_preview_cta_clicked"
          eventProps={{ placement: "proof_section" }}
        >
          Preview My Brief →
        </TrackedLinkButton>
      </div>
    </section>
  );
}
