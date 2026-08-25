// Reusable Claude API wrapper for the Node.js layer. This is the SAME calling
// convention used by the Deno Edge Functions (supabase/functions/_shared/claude.ts)
// so prompt templates in /prompts are portable between the two runtimes.
// Kept here (rather than only in Edge Functions) so the future WhatsApp bot —
// which will run as a Node process, not an Edge Function — can call Claude
// through this same service layer without duplicating logic.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const CLAUDE_MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
};

/**
 * @param {object} opts
 * @param {string} opts.model - one of CLAUDE_MODELS
 * @param {string} opts.system - system prompt
 * @param {string} opts.userMessage - user content (usually JSON.stringify of structured data)
 * @param {number} [opts.maxTokens]
 * @param {boolean} [opts.expectJson] - strip markdown fences / prose and return parsed JSON
 * @returns {Promise<string|object>}
 */
export async function callClaude({ model, system, userMessage, maxTokens = 2048, expectJson = false }) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY is not configured");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text ?? "";

  if (!expectJson) return text;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced ? fenced[1].trim() : text.trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    // Fall back to locating the first { or [ if the model added prose around it.
    const start = Math.min(
      ...[jsonText.indexOf("{"), jsonText.indexOf("[")].filter((i) => i >= 0)
    );
    return JSON.parse(jsonText.slice(start));
  }
}
