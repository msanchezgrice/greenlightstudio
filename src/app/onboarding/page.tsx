import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export default async function OnboardingPage() {
  const authEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const userId = authEnabled ? (await auth()).userId : null;

  return (
    <>
      <nav className="nav">
        <div className="nav-left">
          <Link href={userId ? "/board" : "/"} className="logo">
            ▲ <span>Startup Machine</span>
          </Link>
          <div className="nav-tabs">
            <Link href="/" className="nav-tab">
              Home
            </Link>
            {userId ? (
              <>
                <Link href="/board" className="nav-tab">
                  Board
                </Link>
                <Link href="/chat" className="nav-tab">
                  Chat
                </Link>
                <Link href="/tasks" className="nav-tab">
                  Tasks
                </Link>
              </>
            ) : null}
            <Link href="/onboarding" className="nav-tab active">
              Preview
            </Link>
          </div>
        </div>
        <div className="nav-right">
          {userId ? (
            <Link href="/board" className="btn btn-approve" style={{ padding: "8px 14px", fontSize: 13 }}>
              Dashboard
            </Link>
          ) : authEnabled ? (
            <Link href="/sign-in?redirect_url=/onboarding" className="btn btn-ghost" style={{ padding: "8px 14px", fontSize: 13 }}>
              Sign In To Save
            </Link>
          ) : (
            <span className="nav-pending">Preview mode</span>
          )}
        </div>
      </nav>

      <main className="onboarding-page">
        <header className="onboard-header">
          <div className="logo">▲ Startup Machine</div>
          <span className="badge">FOUNDER PREVIEW</span>
          <span className="header-note">
            {userId
              ? "Signed in. Save and launch whenever you're ready."
              : authEnabled
                ? "No account required to preview. Sign in only when you want to save and launch."
                : "Preview mode only in this environment."}
          </span>
        </header>
        <OnboardingWizard authEnabled={authEnabled} initialSignedIn={Boolean(userId)} />
      </main>
    </>
  );
}
