const required = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function requireEnv(name: (typeof required)[number] | "ANTHROPIC_API_KEY") {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function validateBootEnv() {
  required.forEach((key) => {
    if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
  });
}
