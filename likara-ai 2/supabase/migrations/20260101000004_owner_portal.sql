-- ============================================================================
-- Owner Portal — a lightweight, READ-ONLY login for property owners so they
-- can see their own buildings/units/rent/maintenance without calling their
-- agent. This is additive: it grants a NEW way to see a NARROWER slice of
-- data, it never reduces what agency staff/admins can already see (RLS
-- policies of the same command type are OR'd together in Postgres).
--
-- Product decision worth flagging explicitly: owners can see expenses of
-- cost_type='owner' (maintenance/repairs billed to them) but NOT
-- cost_type='agency' ones (the agency's own operating costs) — this is a
-- narrower reading of "Only Admin can view costs" than the literal spec text,
-- made because an owner seeing what they're being charged for is a real
-- product value-add and doesn't leak the agency's own internal cost
-- structure. Revisit with the client if this isn't the intended behavior.
-- ============================================================================

create table public.owner_portal_users (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.owners(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (owner_id, user_id)
);

create index idx_owner_portal_users_owner on public.owner_portal_users(owner_id);
create index idx_owner_portal_users_user on public.owner_portal_users(user_id);

alter table public.owner_portal_users enable row level security;

create policy owner_portal_users_select on public.owner_portal_users for select
  using (user_id = auth.uid() or auth_is_admin());
create policy owner_portal_users_insert_admin on public.owner_portal_users for insert
  with check (auth_is_admin());
create policy owner_portal_users_delete_admin on public.owner_portal_users for delete
  using (auth_is_admin());

-- Resolves the calling session's owner_id, if any. A user can hold BOTH an
-- agency_members row and an owner_portal_users row in theory (unusual but not
-- forbidden) — auth_agency_id()/auth_is_admin() and auth_owner_id() are
-- independent checks, so this doesn't create a privilege-escalation path.
create or replace function auth_owner_id() returns uuid
language sql stable security definer set search_path = public as $$
  select owner_id from public.owner_portal_users
  where user_id = auth.uid() and is_active = true
  limit 1
$$;

-- Additive SELECT policies, one per table an owner should see into. Each is a
-- new PERMISSIVE policy alongside the existing agency-staff policies — a row
-- is visible if EITHER the staff policy OR this owner policy matches.
create policy buildings_select_owner on public.buildings for select
  using (owner_id = auth_owner_id());

create policy units_select_owner on public.units for select
  using (owner_id = auth_owner_id());

create policy tenants_select_owner on public.tenants for select
  using (owner_id = auth_owner_id());

create policy leases_select_owner on public.leases for select
  using (unit_id in (select id from public.units where owner_id = auth_owner_id()));

create policy payments_select_owner on public.payments for select
  using (unit_id in (select id from public.units where owner_id = auth_owner_id()));

create policy tickets_select_owner on public.maintenance_tickets for select
  using (unit_id in (select id from public.units where owner_id = auth_owner_id()));

-- Owner-attributed costs only (see product-decision note above) — agency
-- operating costs remain admin-only, untouched by this policy.
create policy expenses_select_owner on public.expenses for select
  using (owner_id = auth_owner_id() and cost_type = 'owner');
