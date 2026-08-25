// Thin proxy routes so Retool (and, in Phase 2, the WhatsApp bot) hit ONE
// consistent Node API surface regardless of whether a feature is implemented
// as a Supabase Edge Function or directly in Node. Today all AI features are
// Edge Functions (co-located with the DB for lowest latency); this proxy
// layer means that implementation detail can change later without breaking
// any client.
import { Router } from "express";
import { callEdgeFunction } from "../lib/edgeFunctionClient.js";

const router = Router();

router.post("/lease-summary", async (req, res) => {
  try {
    const data = await callEdgeFunction("lease-summarizer", req.accessToken, req.body);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/maintenance-triage", async (req, res) => {
  try {
    const data = await callEdgeFunction("maintenance-triage", req.accessToken, req.body);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/smart-search", async (req, res) => {
  try {
    const data = await callEdgeFunction("smart-search", req.accessToken, req.body);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/monthly-report", async (req, res) => {
  try {
    const data = await callEdgeFunction("generate-monthly-report", req.accessToken, req.body);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/anomaly-alerts", async (req, res) => {
  let query = req.supabase.from("anomaly_alerts").select("*").order("created_at", { ascending: false });
  if (req.query.is_resolved !== undefined) query = query.eq("is_resolved", req.query.is_resolved === "true");
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data });
});

router.patch("/anomaly-alerts/:id/resolve", async (req, res) => {
  const { data, error } = await req.supabase
    .from("anomaly_alerts")
    .update({ is_resolved: true })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data });
});

router.get("/district-scores", async (req, res) => {
  const { data, error } = await req.supabase
    .from("district_scores")
    .select("*")
    .order("computed_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data });
});

// The "Recalculate" button on the AI Insights page hits THIS endpoint, never
// the Edge Function directly. district-performance-score is deployed with
// --no-verify-jwt (cron needs to call it with no user session) and is gated
// by CRON_SECRET instead — that secret must never reach the browser, so this
// route holds it server-side, checks the caller is a real logged-in user via
// requireAuth (already applied to this whole router in index.js), and only
// then forwards the request with the secret attached.
router.post("/district-scores/recalculate", async (req, res) => {
  try {
    const base = process.env.SUPABASE_URL;
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) throw new Error("CRON_SECRET is not configured on the API server");

    const upstream = await fetch(`${base}/functions/v1/district-performance-score`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({ agency_id: req.body?.agency_id }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.error || "Recalculation failed" });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
