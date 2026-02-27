import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
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
      <SignIn afterSignInUrl="/board" />
    </div>
  );
}
