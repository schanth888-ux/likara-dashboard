# Claude Prompt Templates — Likara AI

These are the canonical, versioned prompt templates. The Edge Functions in
`/supabase/functions/*/index.ts` and the Node service in `/api/src/lib/claudeClient.js`
both embed copies of these — if you edit a prompt, **update it in both the Edge
Function and here**, or better, refactor to load these `.md` files at runtime.

| File | Model | Used by |
|---|---|---|
| [`lease-summarizer.md`](./lease-summarizer.md) | Haiku | `supabase/functions/lease-summarizer` |
| [`maintenance-triage.md`](./maintenance-triage.md) | Haiku | `supabase/functions/maintenance-triage` |
| [`smart-search.md`](./smart-search.md) | Sonnet | `supabase/functions/smart-search` |
| [`anomaly-alert-copy.md`](./anomaly-alert-copy.md) | Haiku | `supabase/functions/anomaly-detection-cron` |
| [`monthly-report.md`](./monthly-report.md) | Sonnet | `supabase/functions/generate-monthly-report` |
| [`district-score.md`](./district-score.md) | Haiku | `supabase/functions/district-performance-score` |
| [`universal-importer-mapping.md`](./universal-importer-mapping.md) | Sonnet | `supabase/functions/universal-importer-extract` |

## Model selection rule (do not deviate without reason)

- **Haiku**: structured extraction/classification/short trilingual copy where the
  input already contains all the facts (triage, alert copy, district score composite).
- **Sonnet**: tasks requiring actual reasoning over ambiguous/messy input — NL→SQL,
  synthesizing a coherent report narrative from numbers, mapping inconsistent
  real-world spreadsheet columns to canonical fields.

## Trilingual output contract

Every prompt that produces user-facing copy must return **all three languages in a
single JSON response** (`_en`, `_zh_cn`, `_zh_hk` suffixes) — never a separate call
per language. This halves latency/cost versus three round-trips and guarantees the
three versions are semantically consistent (generated from the same reasoning pass).

Cantonese (`zh_hk`) must be genuine Hong Kong written Cantonese, not a mechanical
transliteration of the Mandarin version — the prompts explicitly instruct this.
