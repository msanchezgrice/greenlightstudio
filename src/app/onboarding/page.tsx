import { OnboardingWizard } from "@/components/onboarding-wizard";

const stateMachine = `┌───────────────────────────────────────────────────────────────────────────┐
│                    GREENLIGHT STUDIO — ONBOARDING FLOW                  │
└───────────────────────────────────────────────────────────────────────────┘
START → S0 Import → S1 Discover → S1.5 Results → S2 Clarify → S3 Confirm → LAUNCHED
             │              │                │                │
             └── Skip Scan ─┴── Scan Error ─┴── Continue ─────┘`;

const transitions = `S0 + SUBMIT_DOMAIN(domain)    => S1
S0 + SKIP_SCAN(idea_desc)      => S2
S1 + SCAN_COMPLETE             => S1.5
S1 + SCAN_FAILED               => S1.5e
S1.5 + USER_CONFIRMS           => S2
S1.5e + CONTINUE_ANYWAY        => S2
S2 + USER_CONFIRMS             => S3
S3 + LAUNCH                    => LAUNCHED`;

export default function OnboardingPage() {
  return (
    <main className="onboarding-page">
      <header className="onboard-header">
        <div className="logo">▲ Greenlight Studio</div>
        <span className="badge">ONBOARDING WIZARD</span>
        <span className="header-note">State Machine + Interactive Flow</span>
      </header>

      <section className="state-box">
        <h2>State Machine</h2>
        <pre>{stateMachine}</pre>
      </section>

      <section className="state-box">
        <h2>Transition Rules</h2>
        <pre>{transitions}</pre>
      </section>

      <OnboardingWizard />
    </main>
  );
}
