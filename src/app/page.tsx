import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#070b14] text-slate-100 px-6 py-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-green-500">▲ Greenlight Studio</h1>
          <div>
            <SignedOut>
              <SignInButton mode="modal">
                <button className="rounded bg-green-500 px-4 py-2 font-semibold text-[#07141f]">Sign in</button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </div>
        <p className="text-slate-300">AI company builder with onboarding discovery, Phase 0 packet generation, and human approval gates.</p>
        <div className="flex gap-3 flex-wrap">
          <Link href="/onboarding" className="rounded bg-green-500 px-4 py-2 font-semibold text-[#07141f]">Start Onboarding</Link>
          <Link href="/inbox" className="rounded border border-slate-700 px-4 py-2">Open Inbox</Link>
        </div>
      </div>
    </main>
  );
}
