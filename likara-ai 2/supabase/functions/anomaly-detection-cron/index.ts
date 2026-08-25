// Scheduled Edge Function — invoked daily at 09:00 HKT (01:00 UTC) by a
// Supabase Cron trigger (see supabase/config.toml + docs/03-deployment-guide.md
// for the `supabase functions deploy` + cron schedule wiring).
//
// Runs with the SERVICE ROLE client (bypasses RLS) because it must scan across
// ALL agencies to generate each agency's alerts — it manually scopes every
// query by agency_id, which is the standard, audited pattern for cron/service
// jobs in this codebase (see docs/03-deployment-guide.md "Service role usage").
//
// For each agency it flags three anomaly types and writes trilingual alerts
// into anomaly_alerts: late rent, repeated maintenance issues, occupancy drops.
// Model: Haiku — pattern flags on numeric/structured data, not open reasoning.
import { getSupabaseAdmin, hkTodayISO } from "../_shared/supabaseAdmin.ts";
import { callClaude, CLAUDE_MODELS } from "../_shared/claude.ts";
import { captureException } from "../_shared/sentry.ts";
import { sendEmail, alertEmailHtml } from "../_shared/email.ts";

const TRANSLATE_SYSTEM_PROMPT = `You are the trilingual alert-copy engine for Likara AI.
Given a short structured anomaly fact (JSON), write ONE short alert sentence (<=30 words)
in English, Simplified Mandarin, and Traditional Cantonese (Hong Kong written style).
Return STRICT JSON only: {"message_en": "...", "message_zh_cn": "...", "message_zh_hk": "..."}`;

Deno.serve(async (req) => {
  // Defense in depth: this function is deployed with --no-verify-jwt (it's
  // invoked by pg_cron, not a logged-in user), so a shared secret is the only
  // thing stopping an outsider from triggering it directly. Must match the
  // CRON_SECRET set via `supabase secrets set` and referenced in
  // scripts/apply_cron_schedules.sql's net.http_post headers.
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const today = hkTodayISO();
  const results: Record<string, number> = { late_rent: 0, repeated_maintenance: 0, occupancy_drop: 0 };

  const { data: agencies, error: agencyErr } = await supabase
    .from("agencies")
    .select("id")
    .is("deleted_at", null);

  if (agencyErr) {
    console.error("Failed to load agencies:", agencyErr);
    return new Response(JSON.stringify({ error: agencyErr.message }), { status: 500 });
  }

  for (const agency of agencies ?? []) {
    try {
      await detectLateRent(supabase, agency.id, today, results);
      await detectRepeatedMaintenance(supabase, agency.id, results);
      await detectOccupancyDrop(supabase, agency.id, results);
    } catch (err) {
      // One agency's failure (e.g. a transient Claude API error) must never
      // stop the other 9 agencies' daily scan from running.
      await captureException(err, { function: "anomaly-detection-cron", agency_id: agency.id });
    }
  }

  return new Response(JSON.stringify({ status: "ok", date: today, flagged: results }), {
    headers: { "content-type": "application/json" },
  });
});

/** High-severity alerts also get emailed to every admin of the agency — everything
 * else stays dashboard-only so admins aren't trained to ignore the inbox. */
async function notifyAdminsIfHighSeverity(
  supabase: any,
  agencyId: string,
  alert: { type: string; severity: string; message_en: string; message_zh_cn: string; message_zh_hk: string }
) {
  if (alert.severity !== "high") return;
  const { data: admins } = await supabase
    .from("agency_members")
    .select("email")
    .eq("agency_id", agencyId)
    .eq("role", "admin")
    .eq("is_active", true)
    .is("deleted_at", null);

  for (const admin of admins ?? []) {
    await sendEmail({
      to: admin.email,
      subject: `[Likara AI] High-priority alert — ${alert.type.replace("_", " ")}`,
      html: alertEmailHtml(alert),
    });
  }
}

// --- 1. Late rent: payments past due_date + grace_period, still unpaid ------
async function detectLateRent(supabase: any, agencyId: string, today: string, results: Record<string, number>) {
  const { data: latePayments } = await supabase
    .from("payments")
    .select("id, unit_id, tenant_id, due_date, amount, units:unit_id(unit_number), tenants:tenant_id(name_en)")
    .eq("agency_id", agencyId)
    .in("status", ["upcoming", "late"])
    .lt("due_date", today)
    .is("deleted_at", null);

  for (const p of latePayments ?? []) {
    const daysLate = Math.floor(
      (new Date(today).getTime() - new Date(p.due_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    const fact = {
      type: "late_rent",
      unit_number: p.units?.unit_number,
      tenant_name: p.tenants?.name_en,
      amount: p.amount,
      days_late: daysLate,
    };
    const messages = await translateAlert(fact);
    const severity = daysLate > 14 ? "high" : daysLate > 7 ? "medium" : "low";
    await supabase.from("anomaly_alerts").insert({
      agency_id: agencyId,
      type: "late_rent",
      severity,
      related_table: "payments",
      related_id: p.id,
      ...messages,
    });
    await notifyAdminsIfHighSeverity(supabase, agencyId, { type: "late_rent", severity, ...messages });
    // keep payment status in sync
    await supabase.from("payments").update({ status: "late" }).eq("id", p.id);
    results.late_rent++;
  }
}

// --- 2. Repeated maintenance: same unit, 3+ open/completed tickets in 60 days
async function detectRepeatedMaintenance(supabase: any, agencyId: string, results: Record<string, number>) {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const { data: tickets } = await supabase
    .from("maintenance_tickets")
    .select("unit_id, units:unit_id(unit_number)")
    .eq("agency_id", agencyId)
    .gte("created_at", sixtyDaysAgo)
    .is("deleted_at", null);

  const counts = new Map<string, { count: number; unit_number: string }>();
  for (const t of tickets ?? []) {
    const cur = counts.get(t.unit_id) ?? { count: 0, unit_number: t.units?.unit_number };
    cur.count++;
    counts.set(t.unit_id, cur);
  }

  for (const [unitId, info] of counts) {
    if (info.count < 3) continue;
    const fact = { type: "repeated_maintenance", unit_number: info.unit_number, ticket_count: info.count };
    const messages = await translateAlert(fact);
    const severity = info.count >= 5 ? "high" : "medium";
    await supabase.from("anomaly_alerts").insert({
      agency_id: agencyId,
      type: "repeated_maintenance",
      severity,
      related_table: "units",
      related_id: unitId,
      ...messages,
    });
    await notifyAdminsIfHighSeverity(supabase, agencyId, { type: "repeated_maintenance", severity, ...messages });
    results.repeated_maintenance++;
  }
}

// --- 3. Occupancy drop: district occupancy fell >10pp vs. 30 days ago -------
async function detectOccupancyDrop(supabase: any, agencyId: string, results: Record<string, number>) {
  const { data: current } = await supabase
    .from("v_district_summary")
    .select("district, occupancy_pct")
    .eq("agency_id", agencyId);

  // Historical comparison relies on a daily snapshot table (district_scores.breakdown
  // carries occupancy); for MVP we compare against the most recent stored district_scores
  // row older than 25 days, if one exists.
  for (const row of current ?? []) {
    const { data: past } = await supabase
      .from("district_scores")
      .select("breakdown, computed_at")
      .eq("agency_id", agencyId)
      .eq("district", row.district)
      .lt("computed_at", new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString())
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const pastOccupancy = past?.breakdown?.occupancy;
    if (pastOccupancy == null || row.occupancy_pct == null) continue;

    const drop = pastOccupancy - row.occupancy_pct;
    if (drop > 10) {
      const fact = {
        type: "occupancy_drop",
        district: row.district,
        from_pct: pastOccupancy,
        to_pct: row.occupancy_pct,
      };
      const messages = await translateAlert(fact);
      const severity = drop > 20 ? "high" : "medium";
      await supabase.from("anomaly_alerts").insert({
        agency_id: agencyId,
        type: "occupancy_drop",
        severity,
        related_table: "buildings",
        related_id: null,
        ...messages,
      });
      await notifyAdminsIfHighSeverity(supabase, agencyId, { type: "occupancy_drop", severity, ...messages });
      results.occupancy_drop++;
    }
  }
}

async function translateAlert(fact: Record<string, unknown>) {
  const raw = await callClaude({
    model: CLAUDE_MODELS.haiku,
    system: TRANSLATE_SYSTEM_PROMPT,
    userMessage: JSON.stringify(fact),
    maxTokens: 400,
    expectJson: true,
  });
  return JSON.parse(raw) as { message_en: string; message_zh_cn: string; message_zh_hk: string };
}
