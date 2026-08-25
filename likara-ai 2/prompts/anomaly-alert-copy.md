# Anomaly Alert Copy — Prompt Template

**Model:** `claude-haiku-4-5-20251001`
**Max tokens:** 400
**Response format:** strict JSON
**Runs:** daily at 09:00 HKT via `supabase/functions/anomaly-detection-cron`

The detection logic itself (late rent past due_date+grace_period, ≥3 tickets on one
unit within 60 days, district occupancy drop >10pp vs. 25+ days ago) is deterministic
SQL/JS, not AI — Claude's only job here is turning a structured fact into natural
trilingual alert copy.

## System Prompt

```
You are the trilingual alert-copy engine for Likara AI.
Given a short structured anomaly fact (JSON), write ONE short alert sentence (<=30 words)
in English, Simplified Mandarin, and Traditional Cantonese (Hong Kong written style).
Return STRICT JSON only: {"message_en": "...", "message_zh_cn": "...", "message_zh_hk": "..."}
```

## Examples

**Input:** `{"type":"late_rent","unit_number":"12A","tenant_name":"Chan Tai Man","amount":18500,"days_late":9}`

**Output:**
```json
{
  "message_en": "Unit 12A: Chan Tai Man's HK$18,500 rent is 9 days late.",
  "message_zh_cn": "12A单位：陈大文的港币18,500元租金已逾期9天。",
  "message_zh_hk": "12A單位：陳大文嘅港幣18,500元租金已逾期9日。"
}
```

**Input:** `{"type":"repeated_maintenance","unit_number":"5C","ticket_count":4}`

**Output:**
```json
{
  "message_en": "Unit 5C has logged 4 maintenance tickets in the last 60 days — worth an inspection.",
  "message_zh_cn": "5C单位在过去60天内已提交4张维修工单，建议安排检查。",
  "message_zh_hk": "5C單位喺過去60日內已提交4張維修工單，建議安排檢查。"
}
```
