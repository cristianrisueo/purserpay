// Public (anon) Supabase client — safe for the browser. Uses only the
// NEXT_PUBLIC_* env vars, which Next inlines into the client bundle. This is the
// client that will drive magic-link auth (signInWithOtp) once auth is wired.
//
// Note for later: when auth sessions need to survive SSR, this will likely move to
// @supabase/ssr (cookie-based). For now — anon client only, no session plumbing.

import { createClient } from "@supabase/supabase-js"

/**
 * Build a browser/anon Supabase client. Factory (not a module singleton) so that
 * importing this file never throws while env is unconfigured; the env is read and
 * validated on call.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      "Supabase browser client: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.local.example)."
    )
  }

  return createClient(url, anonKey)
}
