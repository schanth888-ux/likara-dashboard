// POST /functions/v1/generate-monthly-report
// Body: { agency_id: string, month: "YYYY-MM", owner_id?: string }
// Collates rent, maintenance, leases, occupancy for the month and returns a
// trilingual report as structured sections (rendered to PDF client-side in
// Retool via a "Generate PDF" component, or server-side with a PDF library —
// see docs/03-deployment-guide.md "PDF rendering options").
// Model: Sonnet — synthesizing numbers into a coherent trilingual narrative
// is exactly the "complex reasoning" case Sonnet is reserved for.
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { getSupabaseForRequest } from "../_shared/supabaseAdmin.ts";
import { callClaude, CLAUDE_MODELS } from "../_shared/claude.ts";
import { captureException } from "../_shared/sentry.ts";

const SYSTEM_PROMPT = `You are the Automated Report engine for Likara AI, a Hong Kong
property management platform. You are given a JSON bundle of this month's raw metrics
(rent collection, maintenance, lease expiries, occupancy). Write a professional monthly
report narrative in three languages: English, Simplified Mandarin, Traditional Cantonese.

Structure (use these exact section headers, translated appropriately per language):
1. Executive Summary (3-4 sentences)
2. Rent Collection (cite the actual numbers given)
3. Occupancy & Portfolio Health
4. Maintenance Activity
5. Leases Expiring Soon (call out anything <30 days as urgent)
6. Recommended Actions (2-4 bullet points)

Rules:
- Use HK$ currency formatting.
- Be specific and cite the numbers you were given — never invent figures.
- Keep total length per language under 500 words.
- Cantonese must read as natural Hong Kong written Cantonese, not a Mandarin transliteration.
Return STRICT JSON only:
{"report_en": "...", "report_zh_cn": "...", "report_zh_hk": "..."}`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const { agency_id, month, owner_id } = await req.json();
    if (!agency_id || !month) {
      return json({ error: "agency_id and month (YYYY-MM) are required" }, 400);
    }

    const supabase = getSupabaseForRequest(req); // RLS-scoped
    const monthStart = `${month}-01`;
    const monthEnd = new Date(new Date(monthStart).setMonth(new Date(monthStart).getMonth() + 1))
      .toISOString()
      .slice(0, 10);

    let rentQuery = supabase
      .from("v_rent_roll")
      .select("status, rent_amount, owner_id")
      .eq("agency_id", agency_id)
      .eq("period_month", monthStart);
    if (owner_id) rentQuery = rentQuery.eq("owner_id", owner_id);
    const { data: rentRows } = await rentQuery;

    const totalCollected = (rentRows ?? [])
      .filter((r) => r.status === "paid")
      .reduce((s, r) => s + Number(r.rent_amount), 0);
    const lateCount = (rentRows ?? []).filter((r) => r.status === "late").length;
    const totalDue = (rentRows ?? []).reduce((s, r) => s + Number(r.rent_amount), 0);

    const { data: tickets } = await supabase
      .from("maintenance_tickets")
      .select("status, priority")
      .eq("agency_id", agency_id)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd)
      .is("deleted_at", null);

    const { data: expiringLeases } = await supabase
      .from("v_lease_status")
      .select("lease_id, days_remaining, expiry_flag")
      .eq("agency_id", agency_id)
      .lt("days_remaining", 90)
      .gte("days_remaining", 0);

    const { data: districtSummary } = await supabase
      .from("v_district_summary")
      .select("district, occupancy_pct, unit_count, occupied_count")
      .eq("agency_id", agency_id);

    const metrics = {
      month,
      rent_collected_hkd: totalCollected,
      rent_due_hkd: totalDue,
      collection_rate_pct: totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 100,
      late_rentals_count: lateCount,
      maintenance_tickets_total: (tickets ?? []).length,
      maintenance_open: (tickets ?? []).filter((t) => t.status === "open").length,
      maintenance_high_priority: (tickets ?? []).filter((t) => t.priority === "high").length,
      leases_expiring_90d: (expiringLeases ?? []).length,
      leases_expiring_30d: (expiringLeases ?? []).filter((l) => l.expiry_flag === "red").length,
      district_occupancy: districtSummary,
    };

    const raw = await callClaude({
      model: CLAUDE_MODELS.sonnet,
      system: SYSTEM_PROMPT,
      userMessage: JSON.stringify(metrics),
      maxTokens: 3000,
      expectJson: true,
    });

    const narrative = JSON.parse(raw);

    return json({ agency_id, month, metrics, ...narrative });
  } catch (err) {
    await captureException(err, { function: "generate-monthly-report" });
    return json({ error: "Internal error generating report" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
