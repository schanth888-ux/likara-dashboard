// POST /functions/v1/lease-summarizer
// Body: { lease_id: string, force?: boolean }
// Returns a trilingual (EN / Mandarin / Cantonese) one-page lease summary.
// Model: Haiku (structured summarization of already-known fields — no
// open-ended reasoning needed, so we keep this cheap and fast).
//
// CACHING: the summary is written back onto leases.ai_summary_en/zh_cn/zh_hk
// (supabase/migrations/20260101000003_ai_output_cache.sql). A cached summary is returned instantly
// unless `force: true` is passed — the Retool "AI Summarize" button should
// pass force:true only when the user explicitly wants a fresh regeneration
// (e.g. after editing the lease); the Leases page's PATCH handler should also
// clear these four columns whenever rent/dates/clauses change, so a stale
// summary is never silently served after an edit.
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { getSupabaseForRequest } from "../_shared/supabaseAdmin.ts";
import { callClaude, CLAUDE_MODELS } from "../_shared/claude.ts";
import { captureException } from "../_shared/sentry.ts";

const SYSTEM_PROMPT = `You are the lease-summary engine for Likara AI, a Hong Kong property
management platform. You will be given structured lease data as JSON. Produce a concise,
professional ONE-PAGE lease summary in three languages: English, Simplified Mandarin
(Putonghua/普通话), and Traditional Cantonese (Hong Kong written Cantonese/廣東話).

Rules:
- Cover: tenant, unit, rent amount (HKD), due day + grace period, lease term (start→end),
  deposit, management fee, and any special clauses.
- Keep each language version to 150-220 words.
- Use HKD currency formatting (e.g. "HK$18,500").
- Dates must read as "DD MMM YYYY" (Asia/Hong_Kong calendar dates, no timezone conversion needed
  since lease dates are already civil dates).
- The Mandarin and Cantonese versions must be idiomatic, not machine-literal translations of
  each other — Cantonese should read naturally to a Hong Kong reader (e.g. use 「租客」「業主」
  「按金」「管理費」 as appropriate), Mandarin should read naturally to a mainland/Taiwan reader.
- Return STRICT JSON only, matching this shape, no markdown fences, no commentary:
{"summary_en": "...", "summary_zh_cn": "...", "summary_zh_hk": "..."}`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  let leaseId: string | undefined;
  try {
    const body = await req.json();
    leaseId = body.lease_id;
    const force = body.force === true;

    if (!leaseId) {
      return json({ error: "lease_id is required" }, 400);
    }

    const supabase = getSupabaseForRequest(req); // RLS-scoped: user can only summarize leases they can see

    const { data: lease, error } = await supabase
      .from("leases")
      .select(
        `id, rent_amount, due_day, grace_period, start_date, end_date, deposit,
         management_fee_type, management_fee_value, management_fee_amount,
         special_clauses_en, special_clauses_zh,
         ai_summary_en, ai_summary_zh_cn, ai_summary_zh_hk, ai_summary_generated_at,
         tenants:tenant_id ( name_en, name_zh, phone ),
         units:unit_id ( unit_number, floor, buildings:building_id ( name_en, name_zh_hk, address ) )`
      )
      .eq("id", leaseId)
      .single();

    if (error || !lease) {
      return json({ error: "Lease not found or not accessible" }, 404);
    }

    if (!force && lease.ai_summary_en && lease.ai_summary_generated_at) {
      return json({
        lease_id: leaseId,
        summary_en: lease.ai_summary_en,
        summary_zh_cn: lease.ai_summary_zh_cn,
        summary_zh_hk: lease.ai_summary_zh_hk,
        cached: true,
        generated_at: lease.ai_summary_generated_at,
      });
    }

    const { ai_summary_en, ai_summary_zh_cn, ai_summary_zh_hk, ai_summary_generated_at, ...leaseForPrompt } = lease;
    const userMessage = JSON.stringify(leaseForPrompt, null, 2);

    const raw = await callClaude({
      model: CLAUDE_MODELS.haiku,
      system: SYSTEM_PROMPT,
      userMessage,
      maxTokens: 1500,
      expectJson: true,
    });

    const parsed = JSON.parse(raw);
    const generatedAt = new Date().toISOString();

    // Write-back uses the same RLS-scoped client — this only succeeds because
    // leases_update already permits the caller (admin or the unit's assigned
    // staff) to update this row; no elevated privileges needed.
    const { error: cacheError } = await supabase
      .from("leases")
      .update({
        ai_summary_en: parsed.summary_en,
        ai_summary_zh_cn: parsed.summary_zh_cn,
        ai_summary_zh_hk: parsed.summary_zh_hk,
        ai_summary_generated_at: generatedAt,
      })
      .eq("id", leaseId);
    if (cacheError) {
      // Non-fatal — the user still gets their summary, it just won't be cached this time.
      console.error("Failed to cache lease summary:", cacheError.message);
    }

    return json({ lease_id: leaseId, ...parsed, cached: false, generated_at: generatedAt });
  } catch (err) {
    await captureException(err, { function: "lease-summarizer", lease_id: leaseId });
    return json({ error: "Internal error generating summary" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
