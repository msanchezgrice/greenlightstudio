import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import styles from "./landing.module.css";
import { WaitlistForm } from "@/components/waitlist-form";
import { LandingProofSection } from "@/components/landing-proof-section";
import { TrackedLinkButton } from "@/components/tracked-link-button";

export default async function Home() {
  const authEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const userId = authEnabled ? (await auth()).userId : null;

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.navLogo}>▲ Startup Machine</div>
        <div className={styles.navLinks}>
          <a href="#how">How It Works</a>
          <a href="#proof">Proof</a>
          <a href="#phases">Phases</a>
          <a href="#features">Features</a>
          {authEnabled && !userId ? (
            <Link href="/sign-in" className={styles.navSignIn}>Sign In</Link>
          ) : null}
          {userId ? (
            <Link href="/board" className={styles.navCta}>Dashboard</Link>
          ) : (
            <TrackedLinkButton
              href="/onboarding?new=1"
              className={styles.navCta}
              eventName="landing_nav_cta_clicked"
              eventProps={{ placement: "nav" }}
            >
              Preview My Brief
            </TrackedLinkButton>
          )}
        </div>
        </div>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroBadge}>Powered by Claude Agent SDK + 8 Specialized Agents</div>
        <h1>Your next idea deserves more than a domain pile.</h1>
        <p>
          Upload a domain, paste an idea, or connect your repo. Our AI CEO agent researches competitors, sizes
          the market, drafts a pitch deck, and delivers a go/no-go recommendation by morning.
        </p>
        <div className={styles.heroCtas}>
          <TrackedLinkButton
            href="/onboarding?new=1"
            className={styles.btnPrimary}
            eventName="landing_hero_cta_clicked"
            eventProps={{ placement: "hero" }}
          >
            Preview My Brief →
          </TrackedLinkButton>
          <a href="#proof" className={styles.btnSecondary}>
            See a sample brief
          </a>
        </div>
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <div className={styles.heroNum}>90s</div>
            <div className={styles.heroLabel}>To first preview</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroNum}>3</div>
            <div className={styles.heroLabel}>Signals before signup</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroNum}>8</div>
            <div className={styles.heroLabel}>Specialized agents</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroNum}>$0</div>
            <div className={styles.heroLabel}>To start</div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="how">
        <div className={styles.sectionLabel}>How It Works</div>
        <div className={styles.sectionTitle}>Idea to founder brief in 4 steps</div>
        <div className={styles.sectionSub}>
          Start with the lightest possible input. See the recommendation first. Sign in only when you want to save and launch.
        </div>
        <div className={styles.steps}>
          <div className={styles.stepCard}>
            <div className={styles.stepNum}>1</div>
            <div className={styles.stepTitle}>Start Small</div>
            <div className={styles.stepDesc}>
              Pick the path that matches what you have right now: a one-line idea, a domain, or a repo.
            </div>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.stepCard}>
            <div className={styles.stepNum}>2</div>
            <div className={styles.stepTitle}>Discover</div>
            <div className={styles.stepDesc}>
              If you have real assets, Startup Machine scans them in read-only mode and surfaces competitor and market clues automatically.
            </div>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.stepCard}>
            <div className={styles.stepNum}>3</div>
            <div className={styles.stepTitle}>Preview</div>
            <div className={styles.stepDesc}>
              Get an instant recommendation, a key risk, and the first market read before you commit to account setup.
            </div>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.stepCard}>
            <div className={styles.stepNum}>4</div>
            <div className={styles.stepTitle}>Launch</div>
            <div className={styles.stepDesc}>
              Save the project, kick off Phase 0, and watch the CEO agent turn the preview into a full decision-ready brief.
            </div>
          </div>
        </div>
      </section>

      <LandingProofSection />

      <section className={styles.section} id="phases">
        <div className={styles.sectionLabel}>Phase Pipeline</div>
        <div className={styles.sectionTitle}>5 phases from idea to revenue</div>
        <div className={styles.sectionSub}>Every phase has a gate. Nothing advances without your explicit approval.</div>
        <div className={styles.phases}>
          <div className={styles.phaseCard}>
            <div className={`${styles.phaseTop} ${styles.phaseTopCyan}`}>Pre-Phase 0</div>
            <div className={styles.phaseBody}>
              <div className={styles.phaseName}>Asset Discovery</div>
              <div className={styles.phaseItems}>DNS scan<br />HTTP probe<br />Tech detection<br />Repo analysis<br />Competitor search</div>
            </div>
          </div>
          <div className={styles.phaseCard}>
            <div className={`${styles.phaseTop} ${styles.phaseTopGreen}`}>Phase 0</div>
            <div className={styles.phaseBody}>
              <div className={styles.phaseName}>Pitch Deck</div>
              <div className={styles.phaseItems}>Market sizing<br />Competitor analysis<br />Target persona<br />MVP scope<br />CEO recommendation<br />.pptx pitch deck</div>
            </div>
          </div>
          <div className={styles.phaseCard}>
            <div className={`${styles.phaseTop} ${styles.phaseTopBlue}`}>Phase 1</div>
            <div className={styles.phaseBody}>
              <div className={styles.phaseName}>Validate</div>
              <div className={styles.phaseItems}>Landing page<br />Waitlist + email<br />Analytics wiring<br />Logo + brand<br />Social strategy</div>
            </div>
          </div>
          <div className={styles.phaseCard}>
            <div className={`${styles.phaseTop} ${styles.phaseTopYellow}`}>Phase 2</div>
            <div className={styles.phaseBody}>
              <div className={styles.phaseName}>Distribute</div>
              <div className={styles.phaseItems}>Social content<br />Meta Ads<br />Email sequences<br />Cold outreach<br />Budget guardrails</div>
            </div>
          </div>
          <div className={styles.phaseCard}>
            <div className={`${styles.phaseTop} ${styles.phaseTopPurple}`}>Phase 3</div>
            <div className={styles.phaseBody}>
              <div className={styles.phaseName}>Go Live</div>
              <div className={styles.phaseItems}>Codex 5.3 builds product<br />Code review (4 agents)<br />Human approves merges<br />Daily snapshots<br />Kill-switch</div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="features">
        <div className={styles.sectionLabel}>Features</div>
        <div className={styles.sectionTitle}>Built for founders, not developers</div>
        <div className={styles.sectionSub}>
          Every feature is designed around how founders actually make decisions.
        </div>
        <div className={styles.featuresGrid}>
          <div className={styles.featCard}>
            <div className={styles.featIcon}>📋</div>
            <div className={styles.featTitle}>Meeting-Style Pitch Decks</div>
            <div className={styles.featDesc}>
              Not a dashboard. A one-pager your CEO would present with confidence score, competitive gaps,
              market sizing, and a clear recommendation.
            </div>
          </div>
          <div className={styles.featCard}>
            <div className={styles.featIcon}>🧠</div>
            <div className={styles.featTitle}>Reasoning Synopsis</div>
            <div className={styles.featDesc}>
              Every agent decision comes with structured reasoning, what it considered, what it rejected, and why.
            </div>
          </div>
          <div className={styles.featCard}>
            <div className={styles.featIcon}>🔍</div>
            <div className={styles.featTitle}>Asset Discovery</div>
            <div className={styles.featDesc}>
              We scan your domain, read your repo, and check what already exists before spending agent cycles.
            </div>
          </div>
          <div className={styles.featCard}>
            <div className={styles.featIcon}>📥</div>
            <div className={styles.featTitle}>Decision Inbox</div>
            <div className={styles.featDesc}>
              Risk-scored approval queue for deploys, ad spend, and code merges. Nothing happens without your OK.
            </div>
          </div>
          <div className={styles.featCard}>
            <div className={styles.featIcon}>🌙</div>
            <div className={styles.featTitle}>Night Shift</div>
            <div className={styles.featDesc}>
              Morning summary shows what was researched, what was built, and what needs your decision.
            </div>
          </div>
          <div className={styles.featCard}>
            <div className={styles.featIcon}>🔒</div>
            <div className={styles.featTitle}>Permission Ladder</div>
            <div className={styles.featDesc}>
              Agents start read-only. Permissions expand as your project advances.
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} id="agents">
        <div className={styles.sectionLabel}>Agent Fleet</div>
        <div className={styles.sectionTitle}>8 specialized agents, one mission</div>
        <div className={styles.sectionSub}>
          Each agent has a defined role, specific tools, and best practices baked in.
        </div>
        <div className={styles.agentsGrid}>
          <div className={styles.agentCard}>
            <div className={styles.agentEmoji}>👔</div>
            <div className={styles.agentName}>CEO Agent</div>
            <div className={styles.agentRole}>Orchestrator · Sonnet 4.6</div>
            <div className={styles.agentTools}>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>pptx</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>pdf</span>
              <span className={styles.toolBadge}>WebSearch</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeBlue}`}>supabase-mcp</span>
            </div>
          </div>
          <div className={styles.agentCard}>
            <div className={styles.agentEmoji}>🔍</div>
            <div className={styles.agentName}>Research</div>
            <div className={styles.agentRole}>Competitor intel · Sonnet 4.6</div>
            <div className={styles.agentTools}>
              <span className={styles.toolBadge}>WebSearch</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>docx</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeBlue}`}>supabase-mcp</span>
            </div>
          </div>
          <div className={styles.agentCard}>
            <div className={styles.agentEmoji}>🔎</div>
            <div className={styles.agentName}>Scanner Helper</div>
            <div className={styles.agentRole}>Asset discovery · inline helper</div>
            <div className={styles.agentTools}>
              <span className={styles.toolBadge}>WebFetch</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeBlue}`}>classify()</span>
              <span className={styles.toolBadge}>repo API</span>
            </div>
          </div>
          <div className={styles.agentCard}>
            <div className={styles.agentEmoji}>🎨</div>
            <div className={styles.agentName}>Design</div>
            <div className={styles.agentRole}>Landing pages · Sonnet 4.6</div>
            <div className={styles.agentTools}>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>frontend-design</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>feature-dev</span>
            </div>
          </div>
          <div className={styles.agentCard}>
            <div className={styles.agentEmoji}>🎭</div>
            <div className={styles.agentName}>Brand</div>
            <div className={styles.agentRole}>Logo &amp; identity · Gemini</div>
            <div className={styles.agentTools}>
              <span className={`${styles.toolBadge} ${styles.toolBadgeBlue}`}>image-gen</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeBlue}`}>supabase-mcp</span>
            </div>
          </div>
          <div className={styles.agentCard}>
            <div className={styles.agentEmoji}>📊</div>
            <div className={styles.agentName}>Finance</div>
            <div className={styles.agentRole}>Market sizing · Sonnet 4.6</div>
            <div className={styles.agentTools}>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>xlsx</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>pdf</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeBlue}`}>stripe-mcp</span>
            </div>
          </div>
          <div className={styles.agentCard}>
            <div className={styles.agentEmoji}>📦</div>
            <div className={styles.agentName}>Repo Analyst</div>
            <div className={styles.agentRole}>Code review · Sonnet 4.6</div>
            <div className={styles.agentTools}>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>code-review</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeBlue}`}>github-mcp</span>
            </div>
          </div>
          <div className={styles.agentCard}>
            <div className={styles.agentEmoji}>⚙️</div>
            <div className={styles.agentName}>Engineering</div>
            <div className={styles.agentRole}>Build &amp; ship · Sonnet 4.6</div>
            <div className={styles.agentTools}>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>feature-dev</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeGreen}`}>security</span>
              <span className={`${styles.toolBadge} ${styles.toolBadgeBlue}`}>codex-mcp</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.powered}>
          <div className={styles.poweredTitle}>BUILT WITH</div>
          <div className={styles.poweredLogos}>
            <span className={styles.poweredItem}>Claude Agent SDK</span>
            <span className={styles.poweredItem}>Claude Sonnet 4.6</span>
            <span className={styles.poweredItem}>xlsx skill</span>
            <span className={styles.poweredItem}>pptx skill</span>
            <span className={styles.poweredItem}>pdf skill</span>
            <span className={styles.poweredItem}>docx skill</span>
            <span className={styles.poweredItem}>frontend-design</span>
            <span className={styles.poweredItem}>code-review</span>
            <span className={styles.poweredItem}>feature-dev</span>
            <span className={styles.poweredItem}>security-guidance</span>
            <span className={styles.poweredItem}>server-github MCP</span>
            <span className={styles.poweredItem}>inline scanner helper</span>
            <span className={styles.poweredItem}>stripe MCP</span>
            <span className={styles.poweredItem}>Gemini (images)</span>
            <span className={styles.poweredItem}>Codex 5.3 (Phase 3)</span>
          </div>
        </div>
      </section>

      <section className={styles.ctaSection} id="cta">
        <div className={styles.ctaTitle}>Want a sample founder brief in your inbox?</div>
        <div className={styles.ctaSub}>Get the sample brief now, or jump straight into a live preview with no account required.</div>
        <WaitlistForm
          source="landing_sample_brief"
          buttonLabel="Email Me A Sample Brief"
          successMessage="You’re in. We saved your sample brief request."
        />
        <div className={styles.ctaLinks}>
          <TrackedLinkButton
            href="/onboarding?new=1"
            className={styles.ctaInlineLink}
            eventName="landing_footer_cta_clicked"
            eventProps={{ placement: "footer" }}
          >
            Start a live preview instead →
          </TrackedLinkButton>
        </div>
      </section>

      <footer className={styles.footer}>
        Startup Machine · Built with Claude Agent SDK · Feb 2026
        <br />
        <span className={styles.footerMark}>▲</span> By builders, for builders.
      </footer>
    </main>
  );
}
