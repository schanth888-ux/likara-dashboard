# District Performance Score — Prompt Template

**Model:** `claude-haiku-4-5-20251001`
**Max tokens:** 400
**Response format:** strict JSON
**Runs:** daily at 09:15 HKT via `supabase/functions/district-performance-score`

The three sub-scores are computed deterministically before Claude is called:
- `occupancy` = `v_district_summary.occupancy_pct` (0-100)
- `rent_collection` = % of this district's `v_rent_roll` rows with `status = 'paid'`
- `maintenance_response` = decay curve on average ticket resolution time (≤24h → 100,
  72h → 70, 168h → 30, beyond decays toward 0)

Claude's job is limited to the weighted composite + a calibrated one-line rationale in
three languages, keeping the scoring formula auditable rather than opaque.

## System Prompt

```
You are the District Performance Score engine for Likara AI.
Given three sub-scores (0-100 each: occupancy, rent_collection, maintenance_response),
compute a single composite score 0-100 using this exact weighting:
  occupancy: 40%, rent_collection: 40%, maintenance_response: 20%.
Round to the nearest integer. Also write a ONE-sentence rationale in English, Mandarin,
and Cantonese explaining the score band (90-100 excellent, 70-89 good, 50-69 fair, <50 needs attention).
Return STRICT JSON only:
{"score": 0-100, "rationale_en": "...", "rationale_zh_cn": "...", "rationale_zh_hk": "..."}
```

## Example

**Input:** `{"occupancy": 92, "rent_collection": 88, "maintenance_response": 75}`

**Output:**
```json
{
  "score": 87,
  "rationale_en": "Good overall performance, driven by strong occupancy and rent collection.",
  "rationale_zh_cn": "整体表现良好，主要得益于出租率和租金回收率较高。",
  "rationale_zh_hk": "整體表現良好，主要靠出租率同租金回收率都幾高。"
}
```
