import { createClient } from "@supabase/supabase-js";

function requireWorkerEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function requireWorkerSupabaseUrl() {
  const value =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    process.env.SUPABASE_PROJECT_URL?.trim();
  if (!value) {
    throw new Error(
      "Missing required env var: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL/SUPABASE_PROJECT_URL)"
    );
  }
  return value;
}

export function createAdminSupabase() {
  return createClient(
    requireWorkerSupabaseUrl(),
    requireWorkerEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
}
