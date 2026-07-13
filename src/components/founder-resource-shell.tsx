import Link from "next/link";

import styles from "@/app/resources/resources.module.css";

export function FounderResourceHeader() {
  return (
    <header className={styles.siteHeader}>
      <div className={styles.siteHeaderInner}>
        <Link href="/" className={styles.brand} aria-label="Startup Machine home">
          <span aria-hidden="true">▲</span> Startup Machine
        </Link>
        <nav className={styles.siteNav} aria-label="Resource navigation">
          <Link href="/resources">Founder resources</Link>
          <Link href="/onboarding?new=1" className={styles.headerCta}>
            Preview my brief
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function FounderResourceFooter() {
  return (
    <footer className={styles.siteFooter}>
      <div>
        <Link href="/" className={styles.footerBrand}>
          <span aria-hidden="true">▲</span> Startup Machine
        </Link>
        <p>Research the opportunity. Make the decision. Build only what earns the next step.</p>
      </div>
      <div className={styles.footerLinks}>
        <Link href="/resources">All founder resources</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/onboarding?new=1">Preview a founder brief</Link>
      </div>
    </footer>
  );
}
