/**
 * Writes a trilingual audit log entry. Called from every route that reads or
 * mutates sensitive data (per P0 security requirement: "Audit Log: Tracks who
 * viewed or changed data").
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - RLS-scoped client
 * @param {object} entry
 * @param {string} entry.agencyId
 * @param {string} entry.userId
 * @param {string} entry.action - e.g. "tenant.create", "lease.view", "export.csv"
 * @param {{en: string, zh_cn: string, zh_hk: string}} entry.details
 */
export async function logAudit(supabase, { agencyId, userId, action, details }) {
  const { error } = await supabase.from("audit_logs").insert({
    agency_id: agencyId,
    user_id: userId,
    action,
    details_en: details?.en ?? null,
    details_zh_cn: details?.zh_cn ?? null,
    details_zh_hk: details?.zh_hk ?? null,
  });
  if (error) {
    // Audit logging must never crash the primary request — log and move on.
    console.error("Failed to write audit log:", error.message);
  }
}
