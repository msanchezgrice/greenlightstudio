import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { requireEnv } from "@/lib/env";

export function createServiceSupabase() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export async function createAuthedSupabase() {
  const { cookies } = await import("next/headers.js");
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
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
