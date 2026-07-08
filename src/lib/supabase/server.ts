// Privileged (service-role) Supabase client — SERVER ONLY. It holds the
// service-role key, which bypasses Row Level Security, so it must never reach the
// browser. Use it only inside Server Actions / Route Handlers.
//
// `import "server-only"` makes that a build-time guarantee: if any client component
// (directly or transitively) imports this file, the build fails. Belt-and-suspenders
// on top of the fact that SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix and
// so is never inlined into a client bundle.

import "server-only"

import { createClient } from "@supabase/supabase-js"

/**
 * Build a service-role Supabase client for server code. Factory (not a module
 * singleton) so importing this file never throws while env is unconfigured; the env
 * is read and validated on call. Sessions are disabled — this is a privileged
 * machine client, not a user session.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase service client: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (see .env.local.example)."
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
