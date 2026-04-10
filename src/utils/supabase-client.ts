/**
 * Supabase client factory.
 *
 * Uses lazy, cached initialization so commands that don't opt into
 * `--push-supabase` never need the env vars and never pay the cost
 * of instantiating a client.
 *
 * This CLI runs as a trusted backend utility (developer machine or CI),
 * so it uses the SERVICE ROLE key, which bypasses Row-Level Security.
 * NEVER ship this key to a browser.
 *
 * Configure by setting `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client.
 * Throws a descriptive error if the required env vars are missing —
 * callers should only invoke this when they actually need the client
 * (e.g. when `--push-supabase` was passed on the CLI).
 */
export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file. ' +
        'See .env.example for details.',
    );
  }

  cached = createClient(url, key, {
    auth: {
      // This is a server-side CLI — no browser session persistence needed.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cached;
}

/** True when both Supabase env vars are present (doesn't instantiate). */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Test-only: reset the cached client so unit tests start clean. */
export function __resetSupabaseClient(): void {
  cached = null;
}
