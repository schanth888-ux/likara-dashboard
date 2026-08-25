import { supabaseForToken } from "../lib/supabaseClient.js";

/**
 * Extracts the Bearer token from the Authorization header, attaches an
 * RLS-scoped Supabase client (`req.supabase`) and the resolved user
 * (`req.user`) to the request. Every downstream route uses `req.supabase`
 * so Postgres RLS — not application code — is the source of truth for
 * multi-tenant isolation and staff "my units" scoping.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization: Bearer <token> header" });
  }

  const supabase = supabaseForToken(token);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  req.supabase = supabase;
  req.user = data.user;
  req.accessToken = token;
  next();
}

/** Route guard for admin-only endpoints (expenses, team management, deletes). */
export async function requireAdmin(req, res, next) {
  const { data, error } = await req.supabase
    .from("agency_members")
    .select("role")
    .eq("user_id", req.user.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .single();

  if (error || data?.role !== "admin") {
    return res.status(403).json({ error: "Admin role required" });
  }
  next();
}
