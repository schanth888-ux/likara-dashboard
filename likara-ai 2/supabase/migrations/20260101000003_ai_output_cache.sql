-- ============================================================================
-- Cache columns for the AI Lease Summarizer. Without these, "AI Summarize"
-- calls Claude fresh on every click — slow and wasteful for a summary that
-- only changes when the lease itself changes.
-- ============================================================================

alter table public.leases
  add column if not exists ai_summary_en text,
  add column if not exists ai_summary_zh_cn text,
  add column if not exists ai_summary_zh_hk text,
  add column if not exists ai_summary_generated_at timestamptz;

comment on column public.leases.ai_summary_generated_at is
  'Set by the lease-summarizer Edge Function. The function treats an existing
   cached summary as valid unless the caller passes force=true (used after the
   lease itself is edited) — see supabase/functions/lease-summarizer/index.ts.';

-- Belt-and-braces: clear the cached summary automatically whenever any
-- summary-relevant field changes, regardless of which client makes the edit
-- (Retool calling Supabase directly, the Node API, a future import). This
-- means the Edge Function's cache check is a performance optimization, not
-- the only thing standing between a user and a stale summary.
create or replace function invalidate_lease_summary_cache() returns trigger
language plpgsql as $$
begin
  if (new.rent_amount, new.due_day, new.grace_period, new.start_date, new.end_date,
      new.deposit, new.management_fee_type, new.management_fee_value,
      coalesce(new.special_clauses_en,''), coalesce(new.special_clauses_zh,''))
     is distinct from
     (old.rent_amount, old.due_day, old.grace_period, old.start_date, old.end_date,
      old.deposit, old.management_fee_type, old.management_fee_value,
      coalesce(old.special_clauses_en,''), coalesce(old.special_clauses_zh,''))
  then
    new.ai_summary_en := null;
    new.ai_summary_zh_cn := null;
    new.ai_summary_zh_hk := null;
    new.ai_summary_generated_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leases_invalidate_summary_cache on public.leases;
create trigger trg_leases_invalidate_summary_cache before update on public.leases
  for each row execute function invalidate_lease_summary_cache();
