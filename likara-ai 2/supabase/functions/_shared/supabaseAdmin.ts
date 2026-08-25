// Service-role Supabase client for Edge Functions.
// Bypasses RLS — every query MUST manually filter by agency_id.
// Env vars are set via `supabase secrets set` (see docs/03-deployment-guide.md).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Client scoped to the calling user's JWT — respects RLS. Use this whenever
// a function is invoked directly from the dashboard (not from cron).
export function getSupabaseForRequest(req: Request) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// HKT date helpers — never use `new Date()` directly for business-date logic.
export function hkTodayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" }); // YYYY-MM-DD
}

export function hkNowISO(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Hong_Kong" }).replace(" ", "T");
}
