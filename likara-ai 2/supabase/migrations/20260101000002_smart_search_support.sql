-- ============================================================================
-- Smart Search support: a read-only SQL execution RPC.
--
-- SECURITY INVOKER is critical here — it means this function runs with the
-- privileges (and RLS policies) of the CALLING user, not the function owner.
-- Combined with `smart-search` Edge Function calling this via the RLS-scoped
-- (anon-key + user JWT) Supabase client, agency isolation is enforced by
-- Postgres itself, independent of anything the AI-generated SQL does or omits.
-- ============================================================================

create or replace function public.execute_readonly_sql(query_text text)
returns jsonb
language plpgsql
security invoker
set statement_timeout = '5s'
as $$
declare
  result jsonb;
begin
  -- Defense in depth: forbid write keywords even though the Edge Function
  -- already filters these before calling here.
  if query_text ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do|vacuum|reindex|refresh)\y' then
    raise exception 'Only read-only SELECT statements are permitted';
  end if;
  if (select count(*) from regexp_split_to_table(trim(trailing ';' from query_text), ';')) > 1 then
    raise exception 'Only a single statement is permitted';
  end if;

  execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', query_text) into result;
  return result;
exception
  when others then
    raise exception 'Query execution failed: %', sqlerrm;
end;
$$;

-- Only authenticated members of an agency may call this — RLS on the underlying
-- tables/views still applies per-row via security invoker.
revoke all on function public.execute_readonly_sql(text) from public;
grant execute on function public.execute_readonly_sql(text) to authenticated;
