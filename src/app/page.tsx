import Link from "next/link";
import styles from "./landing.module.css";
import { WaitlistForm } from "@/components/waitlist-form";
import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.navLogo}>▲ Startup Machine</div>
        <div className={styles.navLinks}>
          <a href="#how">How It Works</a>
          <a href="#phases">Phases</a>
          <a href="#features">Features</a>
          <a href="#agents">Agents</a>
          <SignedOut>
            <SignInButton mode="modal" forceRedirectUrl="/board">
              <button className={styles.navSignIn}>Sign In</button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link href="/board" className={styles.navCta}>Dashboard</Link>
          </SignedIn>
          <SignedOut>
            <Link href="/onboarding" className={styles.navCta}>Get Started</Link>
          </SignedOut>
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
          <Link href="/onboarding" className={styles.btnPrimary}>
            Get Started →
          </Link>
          <a href="#phases" className={styles.btnSecondary}>
            See the pipeline
          </a>
        </div>
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <div className={styles.heroNum}>47m</div>
            <div className={styles.heroLabel}>Avg. time to packet</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroNum}>13</div>
            <div className={styles.heroLabel}>Deliverables per phase</div>
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
        <div className={styles.sectionTitle}>Idea to decision in 4 steps</div>
        <div className={styles.sectionSub}>
          No spreadsheets. No weeks of research. Just drop in your idea and let the agents work.
        </div>
        <div className={styles.steps}>
          <div className={styles.stepCard}>
            <div className={styles.stepNum}>1</div>
            <div className={styles.stepTitle}>Import</div>
            <div className={styles.stepDesc}>
              Drop a domain, paste a repo URL, or describe your idea in plain text. Upload pitch decks or
              wireframes if you have them.
            </div>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.stepCard}>
            <div className={styles.stepNum}>2</div>
            <div className={styles.stepTitle}>Discover</div>
            <div className={styles.stepDesc}>
              Our inline scanner helper checks your domain and reads your repo. Competitors are identified automatically.
            </div>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.stepCard}>
            <div className={styles.stepNum}>3</div>
            <div className={styles.stepTitle}>Clarify</div>
            <div className={styles.stepDesc}>
              Set permissions, choose your runtime mode, and pick focus areas. Everything is safe by default.
            </div>
          </div>
          <div className={styles.stepArrow}>→</div>
          <div className={styles.stepCard}>
            <div className={styles.stepNum}>4</div>
            <div className={styles.stepTitle}>Decide</div>
            <div className={styles.stepDesc}>
              Your CEO Agent produces a meeting-style packet with market sizing, competitors, MVP scope, and a
              confidence-scored recommendation.
            </div>
          </div>
        </div>
      </section>

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
              <div className={styles.phaseName}>Pitch Packet</div>
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
            <div className={styles.featTitle}>Meeting-Style Packets</div>
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
        <div className={styles.ctaTitle}>Ready to decide on your next idea?</div>
        <div className={styles.ctaSub}>Join the waitlist. First 100 projects get Phase 0 free.</div>
        <WaitlistForm />
      </section>

      <footer className={styles.footer}>
        Startup Machine · Built with Claude Agent SDK · Feb 2026
        <br />
        <span className={styles.footerMark}>▲</span> By builders, for builders.
      </footer>
    </main>
  );
}
