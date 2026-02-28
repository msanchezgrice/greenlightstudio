import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { requireEnv } from "@/lib/env";

function requireSupabaseUrl() {
  const value =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    process.env.SUPABASE_PROJECT_URL?.trim();
  if (!value) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL/SUPABASE_PROJECT_URL)",
    );
  }
  return value;
}

export function createServiceSupabase() {
  return createClient(requireSupabaseUrl(), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export async function createAuthedSupabase() {
  const { cookies } = await import("next/headers.js");
  const cookieStore = await cookies();
  return createServerClient(
    requireSupabaseUrl(),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Server components cannot set cookies here.
        },
      },
    },
  );
}
