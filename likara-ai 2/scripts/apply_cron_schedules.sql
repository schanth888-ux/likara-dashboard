-- ============================================================================
-- Cron schedules for daily AI jobs, pinned to 09:00 Asia/Hong_Kong (UTC+8).
-- Run this once in the Supabase SQL editor AFTER both Edge Functions are
-- deployed. Requires the `pg_cron` and `pg_net` extensions (enable both under
-- Database → Extensions in the Supabase dashboard first).
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace <PROJECT_REF> and <CRON_SECRET> with your project's values.
-- CRON_SECRET must match the value read inside each function via
-- Deno.env.get("CRON_SECRET") — add that check to anomaly-detection-cron and
-- district-performance-score before going to production (omitted from the
-- sample function bodies for brevity; both currently rely on verify_jwt=false
-- + being unlisted, which is NOT sufficient on its own for production).

select cron.schedule(
  'likara-anomaly-detection-daily',
  '0 1 * * *',  -- 01:00 UTC = 09:00 HKT
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/anomaly-detection-cron',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'likara-district-score-daily',
  '15 1 * * *', -- 01:15 UTC = 09:15 HKT — runs after anomaly detection
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/district-performance-score',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{}'::jsonb
  );
  $$
);

-- To inspect scheduled jobs:      select * from cron.job;
-- To inspect run history:         select * from cron.job_run_details order by start_time desc limit 20;
-- To unschedule:                  select cron.unschedule('likara-anomaly-detection-daily');
