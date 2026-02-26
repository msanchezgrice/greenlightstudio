import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export default async function OnboardingPage() {
  const { userId } = await auth();

  return (
    <>
      <nav className="nav">
        <div className="nav-left">
          <Link href={userId ? "/board" : "/"} className="logo">
            ▲ <span>Greenlight</span>
          </Link>
          <div className="nav-tabs">
            {userId ? (
              <>
                <Link href="/board" className="nav-tab">
                  Board
                </Link>
                <Link href="/projects" className="nav-tab">
                  Projects
                </Link>
                <Link href="/inbox" className="nav-tab">
                  Inbox
                </Link>
                <Link href="/tasks" className="nav-tab">
                  Tasks
                </Link>
                <Link href="/settings" className="nav-tab">
                  Settings
                </Link>
              </>
            ) : (
              <>
                <Link href="/" className="nav-tab">
                  Home
                </Link>
                <Link href="/sign-in" className="nav-tab">
                  Sign in
                </Link>
              </>
            )}
            <Link href="/onboarding" className="nav-tab active">
              Onboarding
            </Link>
          </div>
        </div>
        <div className="nav-right">
          <Link href={userId ? "/projects" : "/sign-in"} className="btn btn-details">
            {userId ? "Projects" : "Sign in"}
          </Link>
        </div>
      </nav>

      <main className="onboarding-page">
        <header className="onboard-header">
          <div className="logo">▲ Greenlight Studio</div>
          <span className="badge">ONBOARDING WIZARD</span>
        </header>
        <OnboardingWizard />
      </main>
    </>
  );
}
