import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  const authEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg1, #070b14)",
      }}
    >
      {authEnabled ? (
        <SignUp fallbackRedirectUrl="/onboarding" signInUrl="/sign-in" />
      ) : (
        <div
          style={{
            maxWidth: 420,
            padding: 24,
            borderRadius: 16,
            border: "1px solid rgba(148,163,184,.2)",
            background: "rgba(11,18,32,.92)",
            color: "#e2e8f0",
          }}
        >
          <h1 style={{ margin: "0 0 10px", fontSize: 24 }}>Auth Not Configured</h1>
          <p style={{ margin: 0, color: "#94a3b8", lineHeight: 1.6 }}>
            Clerk keys are not configured in this environment, so the sign-up flow is unavailable here.
          </p>
          <p style={{ margin: "16px 0 0" }}>
            <Link href="/onboarding" style={{ color: "#86efac", fontWeight: 600 }}>
              Return to the founder preview
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
