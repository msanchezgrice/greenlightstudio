import { createClient } from "@supabase/supabase-js";

function requireWorkerEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function createAdminSupabase() {
  return createClient(
    requireWorkerEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireWorkerEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
}
