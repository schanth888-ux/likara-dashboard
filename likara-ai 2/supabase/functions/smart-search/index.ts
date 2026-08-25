// POST /functions/v1/smart-search
// Body: { question: string }
// Natural-language → SQL → results. Model: Sonnet (complex reasoning over schema).
//
// SECURITY MODEL (read this before touching this file):
// 1. We execute the generated SQL through the RLS-scoped client built from the
//    caller's own JWT (getSupabaseForRequest), NEVER the service-role client.
//    This means Postgres RLS policies still apply — a malicious or hallucinated
//    query cannot read another agency's rows or bypass the staff "my units" scope,
//    even if the AI-generated SQL forgets a WHERE clause.
// 2. We additionally hard-reject anything that isn't a single read-only SELECT
//    statement (regex + keyword denylist) before it ever reaches Postgres.
// 3. Execution goes through the `execute_readonly_sql` Postgres function (defined
//    in supabase/migrations/20260101000002_smart_search_support.sql) which runs inside a sub-transaction
//    forced to `SET TRANSACTION READ ONLY`, as defense-in-depth.
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { getSupabaseForRequest } from "../_shared/supabaseAdmin.ts";
import { callClaude, CLAUDE_MODELS } from "../_shared/claude.ts";
import { captureException } from "../_shared/sentry.ts";

const SCHEMA_CONTEXT = `
You may ONLY query these tables/views (all already scoped by Postgres RLS to the
caller's agency — never add agency_id filters yourself, they are enforced automatically):

- v_rent_roll(payment_id, unit_id, unit_number, building_id, building_name_en, district,
  sub_district, tenant_id, tenant_name_en, tenant_name_zh, lease_id, rent_amount, due_day,
  grace_period, period_month, due_date, date_paid, status, payment_method,
  relationship_manager_id, owner_id, owner_name_en)
- v_lease_status(lease_id, unit_id, tenant_id, rent_amount, due_day, start_date, end_date,
  days_remaining, expiry_flag, status)
- v_district_summary(district, building_count, unit_count, occupied_count, occupancy_pct,
  open_tickets)
- units(id, building_id, owner_id, unit_number, floor, size_sqft, relationship_manager_id, status)
- buildings(id, owner_id, name_en, name_zh_cn, name_zh_hk, address, district, sub_district, type)
- tenants(id, unit_id, owner_id, name_en, name_zh, phone, email)
- owners(id, name_en, name_zh, phone, email)
- maintenance_tickets(id, unit_id, issue_en, priority, status, channel, vendor_assigned, created_at, resolved_at)
- payments(id, tenant_id, unit_id, amount, period_month, due_date, date_paid, status)

Today's date in Asia/Hong_Kong is provided in the user message as "today".
`;

const SYSTEM_PROMPT = `You are the Smart Search SQL engine for Likara AI, a Hong Kong
property management platform. Convert the user's natural-language question (which may be
in English, Mandarin, or Cantonese) into a single read-only PostgreSQL SELECT statement.

${SCHEMA_CONTEXT}

Rules:
- Output ONLY a SELECT statement (or WITH ... SELECT). No INSERT/UPDATE/DELETE/DDL, ever.
- Never include a semicolon-separated second statement.
- Never reference tables outside the list above.
- Use ILIKE for name matching (case-insensitive, handles partial Chinese/English names).
- Limit results to 200 rows with LIMIT unless the user asks for an aggregate/count.
- Return STRICT JSON only, no markdown fences:
{"sql": "SELECT ...", "explanation_en": "...", "explanation_zh_cn": "...", "explanation_zh_hk": "..."}
The explanation fields are one short sentence describing what the query returns, in each language.`;

const FORBIDDEN_PATTERN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do|vacuum|reindex|refresh)\b/i;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return json({ error: "question is required" }, 400);
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });

    const raw = await callClaude({
      model: CLAUDE_MODELS.sonnet,
      system: SYSTEM_PROMPT,
      userMessage: JSON.stringify({ question, today }),
      maxTokens: 1000,
      expectJson: true,
    });

    const { sql, explanation_en, explanation_zh_cn, explanation_zh_hk } = JSON.parse(raw);

    if (!sql || typeof sql !== "string") {
      return json({ error: "AI did not return a query" }, 502);
    }
    const statementCount = sql.split(";").filter((s: string) => s.trim().length > 0).length;
    if (statementCount !== 1) {
      return json({ error: "Only a single statement is permitted" }, 400);
    }
    if (!/^\s*(with|select)\b/i.test(sql)) {
      return json({ error: "Only SELECT/WITH queries are permitted" }, 400);
    }
    if (FORBIDDEN_PATTERN.test(sql)) {
      return json({ error: "Query contains a disallowed keyword" }, 400);
    }

    const supabase = getSupabaseForRequest(req); // RLS-scoped — critical for tenant isolation
    const { data, error } = await supabase.rpc("execute_readonly_sql", { query_text: sql });

    if (error) {
      console.error("smart-search SQL execution error:", error);
      return json({ error: "Query failed to execute", detail: error.message, sql }, 500);
    }

    return json({
      sql,
      explanation_en,
      explanation_zh_cn,
      explanation_zh_hk,
      results: data,
      row_count: Array.isArray(data) ? data.length : 0,
    });
  } catch (err) {
    await captureException(err, { function: "smart-search" });
    return json({ error: "Internal error running smart search" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
