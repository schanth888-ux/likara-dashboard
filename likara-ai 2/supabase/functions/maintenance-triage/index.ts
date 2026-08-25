// POST /functions/v1/maintenance-triage
// Body: { issue_en?: string, issue_zh_cn?: string, issue_zh_hk?: string, unit_id?: string }
// At least one issue-language field is required. Returns AI-suggested priority,
// vendor type, and trilingual labels. Called from the "Add Ticket" modal in Retool
// as the user types (debounced) or on submit before insert.
// Model: Haiku — fast classification, sub-second latency matters for UX here.
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { callClaude, CLAUDE_MODELS } from "../_shared/claude.ts";
import { captureException } from "../_shared/sentry.ts";

const SYSTEM_PROMPT = `You are the maintenance-triage engine for Likara AI, a Hong Kong
property management platform. Given a free-text description of a maintenance issue
(in English, Mandarin, and/or Cantonese — whichever the user typed), you must:

1. Classify priority: "high" (safety/no water/no power/flooding/gas leak/security),
   "medium" (broken appliance, AC not cooling, plumbing leak - non-flooding, lighting),
   "low" (cosmetic, minor wear, non-urgent requests).
2. Suggest a vendor_type from: "plumber", "electrician", "aircon_technician", "locksmith",
   "general_handyman", "pest_control", "elevator_technician", "cleaner", "other".
3. Produce a short trilingual issue label (<=12 words per language) summarizing the issue,
   even if only one input language was provided — translate/back-fill the other two.

Return STRICT JSON only, no markdown fences, no commentary, in this exact shape:
{
  "priority": "high" | "medium" | "low",
  "vendor_type": "...",
  "confidence": 0.0-1.0,
  "label_en": "...",
  "label_zh_cn": "...",
  "label_zh_hk": "...",
  "reasoning_en": "one short sentence explaining the priority call"
}`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const body = await req.json();
    const { issue_en, issue_zh_cn, issue_zh_hk } = body;

    if (!issue_en && !issue_zh_cn && !issue_zh_hk) {
      return json({ error: "At least one of issue_en, issue_zh_cn, issue_zh_hk is required" }, 400);
    }

    const userMessage = JSON.stringify({ issue_en, issue_zh_cn, issue_zh_hk });

    const raw = await callClaude({
      model: CLAUDE_MODELS.haiku,
      system: SYSTEM_PROMPT,
      userMessage,
      maxTokens: 500,
      expectJson: true,
    });

    const parsed = JSON.parse(raw);
    return json(parsed);
  } catch (err) {
    await captureException(err, { function: "maintenance-triage" });
    return json({ error: "Internal error triaging ticket" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
