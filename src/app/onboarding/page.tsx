import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export default async function OnboardingPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <>
      <nav className="nav">
        <div className="nav-left">
          <Link href="/board" className="logo">
            ▲ <span>Startup Machine</span>
          </Link>
          <div className="nav-tabs">
            <Link href="/board" className="nav-tab">
              Board
            </Link>
            <Link href="/inbox" className="nav-tab">
              Inbox
            </Link>
            <Link href="/chat" className="nav-tab">
              Chat
            </Link>
            <Link href="/tasks" className="nav-tab">
              Tasks
            </Link>
            <Link href="/onboarding" className="nav-tab active">
              Onboarding
            </Link>
          </div>
        </div>
        <div className="nav-right">
          <UserButton
            afterSignOutUrl="/"
            appearance={{ elements: { avatarBox: { width: 30, height: 30 } } }}
          />
        </div>
      </nav>

      <main className="onboarding-page">
        <header className="onboard-header">
          <div className="logo">▲ Startup Machine</div>
          <span className="badge">ONBOARDING WIZARD</span>
        </header>
        <OnboardingWizard />
      </main>
    </>
  );
}
