// Scheduled Edge Function — runs daily at 09:00 HKT, right after
// anomaly-detection-cron (see supabase/config.toml). Also callable ad-hoc via
// POST for a single agency (used by the "Recalculate" button on AI Insights page).
//
// Computes a 0-100 score per district per agency from three inputs:
//   occupancy rate, rent collection rate, maintenance response time.
// Model: Haiku — deterministic weighted formula, AI is used only to turn the
// three sub-scores into a calibrated 0-100 composite + a one-line rationale,
// keeping scoring logic auditable rather than a black box.
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { callClaude, CLAUDE_MODELS } from "../_shared/claude.ts";
import { captureException } from "../_shared/sentry.ts";

const SYSTEM_PROMPT = `You are the District Performance Score engine for Likara AI.
Given three sub-scores (0-100 each: occupancy, rent_collection, maintenance_response),
compute a single composite score 0-100 using this exact weighting:
  occupancy: 40%, rent_collection: 40%, maintenance_response: 20%.
Round to the nearest integer. Also write a ONE-sentence rationale in English, Mandarin,
and Cantonese explaining the score band (90-100 excellent, 70-89 good, 50-69 fair, <50 needs attention).
Return STRICT JSON only:
{"score": 0-100, "rationale_en": "...", "rationale_zh_cn": "...", "rationale_zh_hk": "..."}`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  // This function is deployed with --no-verify-jwt because pg_cron calls it
  // with no user session. That means the shared secret below is the ONLY
  // gate on this endpoint — it must be present on every call, including the
  // ad-hoc "Recalculate" trigger from Retool. NEVER put CRON_SECRET in
  // Retool or any browser-side config to satisfy this check directly; the
  // "Recalculate" button must call api/src/routes/ai.js's
  // POST /api/ai/district-scores/recalculate instead, which holds this
  // secret server-side and forwards the request after checking the caller
  // is an authenticated admin.
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  let agencyIds: string[];

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    agencyIds = body.agency_id ? [body.agency_id] : await allAgencyIds(supabase);
  } else {
    agencyIds = await allAgencyIds(supabase);
  }

  const computed: Array<{ agency_id: string; district: string; score: number }> = [];

  for (const agencyId of agencyIds) {
   try {
    const { data: districts } = await supabase
      .from("v_district_summary")
      .select("district, occupancy_pct, open_tickets, unit_count")
      .eq("agency_id", agencyId);

    for (const d of districts ?? []) {
      const occupancyScore = clamp(d.occupancy_pct ?? 0, 0, 100);
      const rentCollectionScore = await computeRentCollectionScore(supabase, agencyId, d.district);
      const maintenanceScore = await computeMaintenanceResponseScore(supabase, agencyId, d.district);

      const raw = await callClaude({
        model: CLAUDE_MODELS.haiku,
        system: SYSTEM_PROMPT,
        userMessage: JSON.stringify({
          occupancy: occupancyScore,
          rent_collection: rentCollectionScore,
          maintenance_response: maintenanceScore,
        }),
        maxTokens: 400,
        expectJson: true,
      });
      const { score, rationale_en, rationale_zh_cn, rationale_zh_hk } = JSON.parse(raw);

      await supabase.from("district_scores").insert({
        agency_id: agencyId,
        district: d.district,
        score,
        breakdown: {
          occupancy: occupancyScore,
          rent_collection: rentCollectionScore,
          maintenance_response: maintenanceScore,
          rationale_en,
          rationale_zh_cn,
          rationale_zh_hk,
        },
      });

      computed.push({ agency_id: agencyId, district: d.district, score });
    }
   } catch (err) {
    // One agency's failure must never stop the rest of the batch from scoring.
    await captureException(err, { function: "district-performance-score", agency_id: agencyId });
   }
  }

  return new Response(JSON.stringify({ status: "ok", computed }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});

async function allAgencyIds(supabase: any): Promise<string[]> {
  const { data } = await supabase.from("agencies").select("id").is("deleted_at", null);
  return (data ?? []).map((a: { id: string }) => a.id);
}

async function computeRentCollectionScore(supabase: any, agencyId: string, district: string): Promise<number> {
  const { data } = await supabase
    .from("v_rent_roll")
    .select("status")
    .eq("agency_id", agencyId)
    .eq("district", district);
  const rows = data ?? [];
  if (rows.length === 0) return 100;
  const paid = rows.filter((r: { status: string }) => r.status === "paid").length;
  return Math.round((paid / rows.length) * 100);
}

async function computeMaintenanceResponseScore(supabase: any, agencyId: string, district: string): Promise<number> {
  const { data } = await supabase
    .from("maintenance_tickets")
    .select("created_at, resolved_at, units:unit_id(building_id, buildings:building_id(district))")
    .eq("agency_id", agencyId)
    .not("resolved_at", "is", null)
    .is("deleted_at", null);

  const rows = (data ?? []).filter((r: any) => r.units?.buildings?.district === district);
  if (rows.length === 0) return 100;

  const avgHours =
    rows.reduce((sum: number, r: any) => {
      const hours = (new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60);
      return sum + hours;
    }, 0) / rows.length;

  // Scoring curve: <=24h -> 100, 72h -> 70, 168h(1wk) -> 30, beyond decays toward 0.
  if (avgHours <= 24) return 100;
  if (avgHours <= 72) return Math.round(100 - ((avgHours - 24) / 48) * 30);
  if (avgHours <= 168) return Math.round(70 - ((avgHours - 72) / 96) * 40);
  return Math.max(0, Math.round(30 - (avgHours - 168) / 24));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
