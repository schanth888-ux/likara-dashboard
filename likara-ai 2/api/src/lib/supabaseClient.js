import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars — check .env against .env.example");
}

/**
 * Service-role client. BYPASSES RLS. Only use for:
 *  - background jobs that must scan across all agencies (manually scope every
 *    query by agency_id when doing so)
 *  - the file-upload step of the importer, before we know the mapped rows'
 *    target agency-scoped tables
 * Never expose this client or its key to the frontend.
 */
export const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Request-scoped client that carries the caller's own JWT, so every query
 * automatically respects Postgres RLS (agency isolation + staff "my units"
 * scoping). This is the client every route handler should use by default.
 */
export function supabaseForToken(accessToken) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** HKT-safe date helpers — use these everywhere instead of `new Date()` math. */
export function hkTodayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });
}

export function hkNowISO() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Hong_Kong" }).replace(" ", "T");
}
