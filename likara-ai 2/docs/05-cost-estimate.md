# Cost Estimate — Monthly, Per Agency

Figures as provided in the product spec, reproduced here alongside where each cost
actually comes from in this implementation so they can be re-validated as usage grows.

## 1 agency, ~100 units (pilot scale)

| Line item | Est. cost (HKD/month) | Driver in this codebase |
|---|---|---|
| Claude API | 15 – 30 | Haiku calls (triage, alerts, district score) are the bulk of call *volume*; Sonnet calls (Smart Search, monthly report, import mapping) are the bulk of *cost per call* but much lower volume. At ~100 units, expect roughly: 30-60 triage calls/mo, 30 daily anomaly-scan batches, 30 daily district-score batches, <50 Smart Search queries/mo, ~5-10 lease summaries/mo, 1 monthly report/mo. |
| Supabase | 0 – 100 | Free tier covers this scale (500MB DB, 1GB storage, 2GB egress). Paid tier ($25/mo ≈ HK$195) only needed once storage (lease PDFs + ticket photos) or egress exceeds free-tier limits — unlikely at 100 units but worth monitoring Storage usage monthly. |
| Retool | 0 | Free tier: up to 5 users, sufficient for a single small agency's admin + a couple of staff. |
| Netlify | 0 | Free tier, only used for the marketing/legal static pages, negligible traffic. |
| Node API host (Railway/Render) | 0 – ~40 | Most free/hobby tiers (Railway trial credits, Render free web service) cover this; budget ~US$5/mo (~HK$40) once you're off a trial tier. **Not itemized in the original spec's total — see note below.** |
| **Total** | **~15 – 130** (spec) / **~15 – 170** (incl. API host) | |

## 5 agencies, ~500 units combined

| Line item | Est. cost (HKD/month) |
|---|---|
| Claude API | 75 – 150 |
| Supabase | 100 – 200 (paid tier likely needed at this scale — more storage, more concurrent connections) |
| Retool | 0 (free tier still covers small per-agency user counts; re-evaluate if total seats exceed 5) |
| Netlify | 0 |
| Node API host | ~40 – 80 (one shared instance serves all agencies — RLS keeps them isolated) |
| **Total** | **~175 – 350** (spec) / **~215 – 430** (incl. API host) |

## Notes on the API host cost

The original spec's estimate covers Supabase + Retool + Netlify + Claude, which
matches an architecture with **zero custom backend** (Retool talking to Supabase
directly). This implementation adds a Node API layer specifically so business logic
(rent-roll generation, lease renewal, the importer's insert/resolve logic, and — most
importantly — the future WhatsApp bot) isn't duplicated across Retool queries and a
future bot. That layer has a small, real hosting cost (~HK$40-80/month) not present in
a Retool-only build. It is shared across all agencies on one instance, so it does not
scale linearly with agency count the way Claude/Supabase costs do.

If you want to match the original zero-custom-backend estimate exactly for the pilot
demo, the MVP can run with **Retool calling Supabase Edge Functions directly** (skip
the Node API for AI features, which already works per the Edge Function `verify_jwt`
setup) and defer the Node API layer until the WhatsApp bot (Phase 2) actually needs it.
The SQL schema, RLS, and Edge Functions in this repo work either way — the Node API is
additive, not a hard dependency for the Phase 1 dashboard-only MVP.

## Setup fee

HKD 5,000–15,000 one-time, scaled by unit count — covers the onboarding work in
[`docs/04-onboarding-checklist.md`](./04-onboarding-checklist.md) (data collection,
import, staff training). For a 100-unit pilot with reasonably clean source data,
budget the lower end (~HKD 5,000-7,000) of that range.
