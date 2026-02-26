"use client";

import { createClient } from "@supabase/supabase-js";

let cachedClient: ReturnType<typeof createClient> | null = null;

export function createBrowserSupabase() {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  cachedClient = createClient(url, anonKey);
  return cachedClient;
}
