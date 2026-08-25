// Thin wrapper around the Claude Messages API for use inside Deno Edge Functions.
// Model selection follows the product rule: Haiku for simple/structured tasks,
// Sonnet for complex reasoning (NL→SQL, monthly report synthesis).
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const CLAUDE_MODELS = {
  // Fast, cheap, structured extraction / classification / short trilingual copy.
  haiku: "claude-haiku-4-5-20251001",
  // Complex reasoning: NL→SQL, long-form trilingual report synthesis.
  sonnet: "claude-sonnet-5",
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

interface CallClaudeOptions {
  model: ClaudeModel;
  system: string;
  userMessage: string;
  maxTokens?: number;
  /** Force a JSON object response by instructing the model + parsing defensively. */
  expectJson?: boolean;
}

export async function callClaude({
  model,
  system,
  userMessage,
  maxTokens = 2048,
  expectJson = false,
}: CallClaudeOptions): Promise<string> {
  const apiKey = Deno.env.get("CLAUDE_API_KEY");
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
  const text: string = data.content?.[0]?.text ?? "";

  if (expectJson) {
    return extractJson(text);
  }
  return text;
}

/** Claude sometimes wraps JSON in prose or ```json fences — strip defensively. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const start =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (start === -1) return text.trim();
  return text.slice(start).trim();
}
