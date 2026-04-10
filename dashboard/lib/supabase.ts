/**
 * Supabase client factory for the dashboard.
 *
 * The CLI pushes data using the SERVICE ROLE key; the dashboard reads
 * it back using the public ANON key. Supabase Row-Level Security
 * policies should allow `select` on the `test_matrices` and
 * `bug_reports` tables for the `anon` role.
 *
 * This module intentionally tolerates missing env vars — returning
 * `null` rather than throwing — so the dashboard can render a
 * "setup required" state the first time someone opens it on Render.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    cached = null;
    return null;
  }

  cached = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}

/** True when both public Supabase env vars are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
