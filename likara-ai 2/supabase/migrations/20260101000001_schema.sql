-- ============================================================================
-- LIKARA AI — Property Command Centre
-- Supabase (PostgreSQL) schema — multi-tenant, RLS-secured, PDPO-compliant
-- Timezone convention: all `timestamptz` columns are stored in UTC by Postgres
-- and MUST be rendered/interpreted as Asia/Hong_Kong (UTC+8) in every client,
-- Edge Function, and Retool query. `date` columns (due_day cycles, lease
-- dates, etc.) are timezone-naive by design — always compute them against
-- `(now() AT TIME ZONE 'Asia/Hong_Kong')`, never against the server's UTC now().
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- fuzzy name / address search

-- Convenience: HK "now" used throughout functions & policies.
create or replace function hk_now() returns timestamptz
language sql stable as $$ select now() $$; -- now() is UTC internally; cast at read time with `at time zone`

-- ============================================================================
-- 0. REFERENCE DATA — Geographic hierarchy (District → Sub-District)
-- ============================================================================

create table public.district_reference (
  district     text not null,
  sub_district text not null,
  primary key (district, sub_district),
  constraint district_valid check (district in (
    'Hong Kong Island', 'Kowloon', 'New Territories', 'Lantau Island', 'Outlying Islands'
  ))
);

insert into public.district_reference (district, sub_district) values
  ('Hong Kong Island','Central'), ('Hong Kong Island','Wan Chai'), ('Hong Kong Island','Causeway Bay'),
  ('Hong Kong Island','North Point'), ('Hong Kong Island','Quarry Bay'), ('Hong Kong Island','Shau Kei Wan'),
  ('Hong Kong Island','Chai Wan'), ('Hong Kong Island','Aberdeen'), ('Hong Kong Island','Stanley'),
  ('Hong Kong Island','Repulse Bay'),
  ('Kowloon','Tsim Sha Tsui'), ('Kowloon','Mong Kok'), ('Kowloon','Yau Ma Tei'), ('Kowloon','Jordan'),
  ('Kowloon','Sham Shui Po'), ('Kowloon','Cheung Sha Wan'), ('Kowloon','Kowloon Tong'),
  ('Kowloon','Kowloon City'), ('Kowloon','Kwun Tong'), ('Kowloon','Ngau Tau Kok'), ('Kowloon','San Po Kong'),
  ('New Territories','Tai Po'), ('New Territories','Sha Tin'), ('New Territories','Tuen Mun'),
  ('New Territories','Yuen Long'), ('New Territories','Fanling'), ('New Territories','Sheung Shui'),
  ('New Territories','Sai Kung'), ('New Territories','Tsuen Wan'), ('New Territories','Kwai Chung'),
  ('New Territories','Tsing Yi'), ('New Territories','Ma On Shan'), ('New Territories','Tung Chung'),
  ('Lantau Island','Mui Wo'), ('Lantau Island','Discovery Bay'), ('Lantau Island','Tung Chung'),
  ('Lantau Island','Tai O'),
  ('Outlying Islands','Cheung Chau'), ('Outlying Islands','Lamma Island'), ('Outlying Islands','Peng Chau')
on conflict do nothing;

-- ============================================================================
-- 1. AGENCIES — root tenant table
-- ============================================================================

create table public.agencies (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  email             text not null unique,
  phone             text,
  subscription_tier text not null default 'phase1'
                      check (subscription_tier in ('phase1','phase2','phase3')),
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

comment on table public.agencies is 'Root multi-tenant entity. Every other table traces back to one agency.';

-- ----------------------------------------------------------------------------
-- agency_members — bridges Supabase auth.users to an agency + role.
-- Not explicitly listed in the product spec's table list, but required to
-- implement RLS multi-tenancy and RBAC (admin/staff) against auth.users.
-- ----------------------------------------------------------------------------
create table public.agency_members (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'staff' check (role in ('admin','staff')),
  full_name   text not null,
  email       text not null,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (agency_id, user_id)
);

create index idx_agency_members_agency on public.agency_members(agency_id);
create index idx_agency_members_user on public.agency_members(user_id);

-- ============================================================================
-- 2. OWNERS
-- ============================================================================

create table public.owners (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  name_en    text not null,
  name_zh    text,
  phone      text,
  email      text,
  address    text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_owners_agency on public.owners(agency_id) where deleted_at is null;
create index idx_owners_name_trgm on public.owners using gin (name_en gin_trgm_ops, name_zh gin_trgm_ops);

-- ============================================================================
-- 3. BUILDINGS
-- ============================================================================

create table public.buildings (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  owner_id      uuid references public.owners(id) on delete set null,
  name_en       text not null,
  name_zh_cn    text,
  name_zh_hk    text,
  address       text not null,
  district      text not null,
  sub_district  text not null,
  type          text not null default 'residential'
                  check (type in ('residential','commercial','industrial','mixed-use')),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  foreign key (district, sub_district) references public.district_reference(district, sub_district)
);

create index idx_buildings_agency on public.buildings(agency_id) where deleted_at is null;
create index idx_buildings_owner on public.buildings(owner_id);
create index idx_buildings_district on public.buildings(district, sub_district);

-- ============================================================================
-- 4. UNITS — the atomic entity. Everything links here.
-- agency_id is denormalized from buildings for RLS/query performance at
-- 1,000-units-per-agency scale (avoids a join on every policy check).
-- ============================================================================

create table public.units (
  id                     uuid primary key default gen_random_uuid(),
  agency_id              uuid not null references public.agencies(id) on delete cascade,
  building_id            uuid not null references public.buildings(id) on delete cascade,
  owner_id               uuid references public.owners(id) on delete set null,
  unit_number            text not null,
  floor                  text,
  size_sqft              numeric(10,2),
  relationship_manager_id uuid references auth.users(id) on delete set null,
  status                 text not null default 'vacant'
                           check (status in ('vacant','occupied','maintenance','unavailable')),
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  unique (building_id, unit_number)
);

create index idx_units_agency on public.units(agency_id) where deleted_at is null;
create index idx_units_building on public.units(building_id);
create index idx_units_owner on public.units(owner_id);
create index idx_units_status on public.units(status);
create index idx_units_manager on public.units(relationship_manager_id);

-- keep units.agency_id in sync with its building automatically
create or replace function sync_unit_agency_id() returns trigger
language plpgsql as $$
begin
  select agency_id into new.agency_id from public.buildings where id = new.building_id;
  return new;
end;
$$;
create trigger trg_units_sync_agency before insert or update of building_id on public.units
  for each row execute function sync_unit_agency_id();

-- ============================================================================
-- 5. TENANTS
-- ============================================================================

create table public.tenants (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies(id) on delete cascade,
  unit_id            uuid not null references public.units(id) on delete cascade,
  owner_id           uuid references public.owners(id) on delete set null,
  name_en            text not null,
  name_zh            text,
  phone              text,      -- HK 8-digit format, validated at application layer
  email              text,
  emergency_contact  text,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index idx_tenants_agency on public.tenants(agency_id) where deleted_at is null;
create index idx_tenants_unit on public.tenants(unit_id);
create index idx_tenants_owner on public.tenants(owner_id);
create index idx_tenants_name_trgm on public.tenants using gin (name_en gin_trgm_ops, name_zh gin_trgm_ops);

-- NOTE: the trg_tenants_sync_agency trigger is created later, in the "Helper
-- triggers" block below, once sync_unit_agency_id_from_unit() has been defined
-- (that function itself needs the units table, defined above tenants but the
-- function body is grouped with its sibling leases/tickets/payments triggers
-- for readability). Do not create it here — the function doesn't exist yet.

-- ============================================================================
-- 6. LEASES
-- ============================================================================

create table public.leases (
  id                     uuid primary key default gen_random_uuid(),
  agency_id              uuid not null references public.agencies(id) on delete cascade,
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  unit_id                uuid not null references public.units(id) on delete cascade,
  rent_amount            numeric(12,2) not null check (rent_amount >= 0),
  due_day                int not null check (due_day between 1 and 31),
  grace_period           int not null default 3 check (grace_period >= 0),
  start_date             date not null,
  end_date               date not null check (end_date > start_date),
  deposit                numeric(12,2) default 0,
  management_fee_type    text check (management_fee_type in ('percentage','fixed')),
  management_fee_value   numeric(12,2),
  management_fee_amount  numeric(12,2),
  lease_document_url     text,
  lease_document_name    text,
  special_clauses_en     text,
  special_clauses_zh     text,
  status                 text not null default 'active'
                           check (status in ('active','expired','terminated','renewed')),
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

create index idx_leases_agency on public.leases(agency_id) where deleted_at is null;
create index idx_leases_unit on public.leases(unit_id);
create index idx_leases_tenant on public.leases(tenant_id);
create index idx_leases_due_day on public.leases(due_day);
create index idx_leases_end_date on public.leases(end_date);
create index idx_leases_status on public.leases(status);

-- ============================================================================
-- Helper triggers that needed leases/units defined first
-- ============================================================================

create or replace function sync_unit_agency_id_from_unit() returns trigger
language plpgsql as $$
begin
  select agency_id into new.agency_id from public.units where id = new.unit_id;
  return new;
end;
$$;

-- retro-attach the tenants trigger now that the function exists
drop trigger if exists trg_tenants_sync_agency on public.tenants;
create trigger trg_tenants_sync_agency before insert or update of unit_id on public.tenants
  for each row execute function sync_unit_agency_id_from_unit();

create trigger trg_leases_sync_agency before insert or update of unit_id on public.leases
  for each row execute function sync_unit_agency_id_from_unit();

-- ============================================================================
-- 7. MAINTENANCE TICKETS
-- ============================================================================

create table public.maintenance_tickets (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  unit_id        uuid not null references public.units(id) on delete cascade,
  issue_en       text,
  issue_zh_cn    text,
  issue_zh_hk    text,
  priority       text check (priority in ('high','medium','low')),
  status         text not null default 'open'
                   check (status in ('open','in_progress','completed','cancelled')),
  channel        text check (channel in ('phone','whatsapp','email','walk-in','portal','other')),
  vendor_assigned text,
  photo_url      text,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  deleted_at     timestamptz
);

create index idx_tickets_agency on public.maintenance_tickets(agency_id) where deleted_at is null;
create index idx_tickets_unit on public.maintenance_tickets(unit_id);
create index idx_tickets_status on public.maintenance_tickets(status);
create index idx_tickets_priority on public.maintenance_tickets(priority);
create index idx_tickets_created on public.maintenance_tickets(created_at);

create trigger trg_tickets_sync_agency before insert or update of unit_id on public.maintenance_tickets
  for each row execute function sync_unit_agency_id_from_unit();

-- ============================================================================
-- 8. PAYMENTS (rent roll)
-- period_month / due_date are additions to the base spec: rent-roll tables
-- and "late rent" logic need a concrete due date per billing cycle, computed
-- from lease.due_day at HKT, not just a free-floating status flag.
-- ============================================================================

create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  unit_id        uuid not null references public.units(id) on delete cascade,
  lease_id       uuid references public.leases(id) on delete set null,
  amount         numeric(12,2) not null check (amount >= 0),
  period_month   date not null,              -- first day of the billing month, HKT
  due_date       date not null,              -- period_month + due_day - 1, HKT
  date_paid      date,
  status         text not null default 'upcoming'
                   check (status in ('paid','late','upcoming','partial')),
  payment_method text check (payment_method in ('bank_transfer','cheque','cash','fps','other')),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (lease_id, period_month)
);

create index idx_payments_agency on public.payments(agency_id) where deleted_at is null;
create index idx_payments_unit on public.payments(unit_id);
create index idx_payments_tenant on public.payments(tenant_id);
create index idx_payments_status on public.payments(status);
create index idx_payments_due_date on public.payments(due_date);

create trigger trg_payments_sync_agency before insert or update of unit_id on public.payments
  for each row execute function sync_unit_agency_id_from_unit();

-- ============================================================================
-- 9. EXPENSES — dual-layer costs (owner vs agency)
-- ============================================================================

create table public.expenses (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  unit_id          uuid references public.units(id) on delete set null,
  building_id      uuid references public.buildings(id) on delete set null,
  owner_id         uuid references public.owners(id) on delete set null,
  cost_type        text not null check (cost_type in ('owner','agency')),
  category         text not null,
  type             text not null check (type in ('fixed','variable')),
  amount           numeric(12,2) not null check (amount >= 0),
  description      text,
  date_incurred    date not null,
  recurring_monthly boolean not null default false,
  vendor           text,
  notes            text,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index idx_expenses_agency on public.expenses(agency_id) where deleted_at is null;
create index idx_expenses_unit on public.expenses(unit_id);
create index idx_expenses_building on public.expenses(building_id);
create index idx_expenses_owner on public.expenses(owner_id);
create index idx_expenses_cost_type on public.expenses(cost_type);
create index idx_expenses_date on public.expenses(date_incurred);

-- ============================================================================
-- 10. AUDIT LOGS — immutable, no soft delete
-- ============================================================================

create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  action        text not null,           -- e.g. 'tenant.create', 'lease.view', 'export.csv'
  details_en    text,
  details_zh_cn text,
  details_zh_hk text,
  created_at    timestamptz not null default now()
);

create index idx_audit_agency on public.audit_logs(agency_id);
create index idx_audit_user on public.audit_logs(user_id);
create index idx_audit_created on public.audit_logs(created_at);

-- ============================================================================
-- 11. UNIT STAFF ASSIGNMENTS (optional multi-staff-per-unit)
-- ============================================================================

create table public.unit_staff_assignments (
  id           uuid primary key default gen_random_uuid(),
  unit_id      uuid not null references public.units(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'support' check (role in ('primary','support')),
  assigned_at  timestamptz not null default now(),
  unique (unit_id, user_id)
);

create index idx_unit_staff_unit on public.unit_staff_assignments(unit_id);
create index idx_unit_staff_user on public.unit_staff_assignments(user_id);

-- ============================================================================
-- 12. UNIVERSAL DATA IMPORTER support tables
-- ============================================================================

create table public.data_import_jobs (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null references public.agencies(id) on delete cascade,
  uploaded_by           uuid references auth.users(id),
  file_name             text not null,
  file_type             text not null check (file_type in ('pdf','xlsx','xls','csv','docx','jpg','png')),
  storage_path          text not null,       -- Supabase Storage object path
  detected_data_type    text check (detected_data_type in
                           ('tenants','leases','maintenance_tickets','owners','buildings','units','payments')),
  status                text not null default 'pending'
                           check (status in ('pending','extracted','mapped','confirmed','completed','failed')),
  raw_extracted_text    text,
  ai_mapping_json       jsonb,
  row_count             int default 0,
  error_message         text,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);

create index idx_import_jobs_agency on public.data_import_jobs(agency_id);
create index idx_import_jobs_status on public.data_import_jobs(status);

create table public.data_import_rows (
  id              uuid primary key default gen_random_uuid(),
  import_job_id   uuid not null references public.data_import_jobs(id) on delete cascade,
  row_number      int not null,
  raw_data        jsonb,
  mapped_data     jsonb,
  status          text not null default 'pending'
                    check (status in ('pending','confirmed','rejected','inserted','error')),
  error_message   text,
  target_table    text,
  target_id       uuid,
  created_at      timestamptz not null default now()
);

create index idx_import_rows_job on public.data_import_rows(import_job_id);
create index idx_import_rows_status on public.data_import_rows(status);

-- ============================================================================
-- 13. AI FEATURE SUPPORT TABLES
-- ============================================================================

create table public.district_scores (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  district     text not null,
  score        int not null check (score between 0 and 100),
  breakdown    jsonb,   -- {occupancy: 0-100, rent_collection: 0-100, maintenance_response: 0-100}
  computed_at  timestamptz not null default now()
);

create index idx_district_scores_agency on public.district_scores(agency_id, district, computed_at desc);

create table public.anomaly_alerts (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null references public.agencies(id) on delete cascade,
  type           text not null check (type in ('late_rent','repeated_maintenance','occupancy_drop')),
  severity       text not null default 'medium' check (severity in ('high','medium','low')),
  message_en     text not null,
  message_zh_cn  text not null,
  message_zh_hk  text not null,
  related_table  text,
  related_id     uuid,
  is_resolved    boolean not null default false,
  created_at     timestamptz not null default now()
);

create index idx_anomaly_agency on public.anomaly_alerts(agency_id, is_resolved);
create index idx_anomaly_created on public.anomaly_alerts(created_at);

-- ============================================================================
-- 14. RLS HELPER FUNCTIONS (security definer, read agency_members safely)
-- ============================================================================

create or replace function auth_agency_id() returns uuid
language sql stable security definer set search_path = public as $$
  select agency_id from public.agency_members
  where user_id = auth.uid() and is_active = true and deleted_at is null
  limit 1
$$;

create or replace function auth_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agency_members
    where user_id = auth.uid() and role = 'admin' and is_active = true and deleted_at is null
  )
$$;

create or replace function auth_is_assigned_to_unit(target_unit_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.units u
    where u.id = target_unit_id and u.relationship_manager_id = auth.uid()
  ) or exists (
    select 1 from public.unit_staff_assignments usa
    where usa.unit_id = target_unit_id and usa.user_id = auth.uid()
  )
$$;

-- ============================================================================
-- 15. ROW LEVEL SECURITY
-- ============================================================================

alter table public.agencies enable row level security;
alter table public.agency_members enable row level security;
alter table public.owners enable row level security;
alter table public.buildings enable row level security;
alter table public.units enable row level security;
alter table public.tenants enable row level security;
alter table public.leases enable row level security;
alter table public.maintenance_tickets enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;
alter table public.unit_staff_assignments enable row level security;
alter table public.data_import_jobs enable row level security;
alter table public.data_import_rows enable row level security;
alter table public.district_scores enable row level security;
alter table public.anomaly_alerts enable row level security;

-- agencies: a member can only read their own agency row
create policy agencies_select on public.agencies for select
  using (id = auth_agency_id());
create policy agencies_update_admin on public.agencies for update
  using (id = auth_agency_id() and auth_is_admin());

-- agency_members: visible to admins of the same agency; a user can see own row
create policy members_select on public.agency_members for select
  using (agency_id = auth_agency_id() and (auth_is_admin() or user_id = auth.uid()));
create policy members_write_admin on public.agency_members for insert
  with check (agency_id = auth_agency_id() and auth_is_admin());
create policy members_update_admin on public.agency_members for update
  using (agency_id = auth_agency_id() and auth_is_admin());
create policy members_delete_admin on public.agency_members for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

-- owners: full agency visibility (staff need owner contact info for their units)
create policy owners_select on public.owners for select
  using (agency_id = auth_agency_id());
create policy owners_insert on public.owners for insert
  with check (agency_id = auth_agency_id());
create policy owners_update on public.owners for update
  using (agency_id = auth_agency_id());
create policy owners_delete_admin on public.owners for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

-- buildings: agency-wide visibility
create policy buildings_select on public.buildings for select
  using (agency_id = auth_agency_id());
create policy buildings_insert on public.buildings for insert
  with check (agency_id = auth_agency_id());
create policy buildings_update on public.buildings for update
  using (agency_id = auth_agency_id());
create policy buildings_delete_admin on public.buildings for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

-- units: admin sees all; staff sees only assigned units ("My Units")
create policy units_select on public.units for select
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(id)));
create policy units_insert_admin on public.units for insert
  with check (agency_id = auth_agency_id() and auth_is_admin());
create policy units_update on public.units for update
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(id)));
create policy units_delete_admin on public.units for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

-- tenants: scoped through unit assignment
create policy tenants_select on public.tenants for select
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy tenants_insert on public.tenants for insert
  with check (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy tenants_update on public.tenants for update
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy tenants_delete_admin on public.tenants for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

-- leases: scoped through unit assignment
create policy leases_select on public.leases for select
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy leases_insert on public.leases for insert
  with check (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy leases_update on public.leases for update
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy leases_delete_admin on public.leases for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

-- maintenance_tickets: scoped through unit assignment
create policy tickets_select on public.maintenance_tickets for select
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy tickets_insert on public.maintenance_tickets for insert
  with check (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy tickets_update on public.maintenance_tickets for update
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy tickets_delete_admin on public.maintenance_tickets for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

-- payments: scoped through unit assignment
create policy payments_select on public.payments for select
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy payments_insert on public.payments for insert
  with check (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy payments_update on public.payments for update
  using (agency_id = auth_agency_id() and (auth_is_admin() or auth_is_assigned_to_unit(unit_id)));
create policy payments_delete_admin on public.payments for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

-- expenses: ADMIN ONLY, per spec ("Staff cannot see costs")
create policy expenses_admin_only on public.expenses for all
  using (agency_id = auth_agency_id() and auth_is_admin())
  with check (agency_id = auth_agency_id() and auth_is_admin());

-- audit_logs: admins read all; staff read only their own actions; system inserts via service role
create policy audit_select on public.audit_logs for select
  using (agency_id = auth_agency_id() and (auth_is_admin() or user_id = auth.uid()));
create policy audit_insert on public.audit_logs for insert
  with check (agency_id = auth_agency_id());

-- unit_staff_assignments: admin manages; staff can see their own assignments
create policy unit_staff_select on public.unit_staff_assignments for select
  using (auth_is_admin() or user_id = auth.uid());
create policy unit_staff_write_admin on public.unit_staff_assignments for insert
  with check (auth_is_admin());
create policy unit_staff_update_admin on public.unit_staff_assignments for update
  using (auth_is_admin());
create policy unit_staff_delete_admin on public.unit_staff_assignments for delete
  using (auth_is_admin());

-- data importer: agency-wide, any member can upload; admin can delete
create policy import_jobs_select on public.data_import_jobs for select
  using (agency_id = auth_agency_id());
create policy import_jobs_insert on public.data_import_jobs for insert
  with check (agency_id = auth_agency_id());
create policy import_jobs_update on public.data_import_jobs for update
  using (agency_id = auth_agency_id());
create policy import_jobs_delete_admin on public.data_import_jobs for delete
  using (agency_id = auth_agency_id() and auth_is_admin());

create policy import_rows_select on public.data_import_rows for select
  using (exists (select 1 from public.data_import_jobs j
                 where j.id = import_job_id and j.agency_id = auth_agency_id()));
create policy import_rows_write on public.data_import_rows for all
  using (exists (select 1 from public.data_import_jobs j
                 where j.id = import_job_id and j.agency_id = auth_agency_id()))
  with check (exists (select 1 from public.data_import_jobs j
                 where j.id = import_job_id and j.agency_id = auth_agency_id()));

-- district_scores / anomaly_alerts: agency-wide read, system (service role) writes
create policy district_scores_select on public.district_scores for select
  using (agency_id = auth_agency_id());
create policy anomaly_alerts_select on public.anomaly_alerts for select
  using (agency_id = auth_agency_id());
create policy anomaly_alerts_update on public.anomaly_alerts for update
  using (agency_id = auth_agency_id());

-- ============================================================================
-- 16. CONVENIENCE VIEWS (used heavily by Retool + AI Smart Search)
-- ============================================================================

create or replace view public.v_rent_roll as
select
  p.id as payment_id, p.agency_id, u.id as unit_id, u.unit_number, b.id as building_id,
  b.name_en as building_name_en, b.district, b.sub_district,
  t.id as tenant_id, t.name_en as tenant_name_en, t.name_zh as tenant_name_zh,
  l.id as lease_id, l.rent_amount, l.due_day, l.grace_period,
  p.period_month, p.due_date, p.date_paid, p.status, p.payment_method,
  u.relationship_manager_id, o.id as owner_id, o.name_en as owner_name_en
from public.payments p
join public.units u on u.id = p.unit_id
join public.buildings b on b.id = u.building_id
join public.tenants t on t.id = p.tenant_id
left join public.leases l on l.id = p.lease_id
left join public.owners o on o.id = u.owner_id
where p.deleted_at is null;

create or replace view public.v_lease_status as
select
  l.id as lease_id, l.agency_id, l.unit_id, l.tenant_id, l.rent_amount, l.due_day,
  l.start_date, l.end_date,
  (l.end_date - (now() at time zone 'Asia/Hong_Kong')::date) as days_remaining,
  case
    when (l.end_date - (now() at time zone 'Asia/Hong_Kong')::date) < 30 then 'red'
    when (l.end_date - (now() at time zone 'Asia/Hong_Kong')::date) < 60 then 'yellow'
    else 'green'
  end as expiry_flag,
  l.status
from public.leases l
where l.deleted_at is null;

create or replace view public.v_district_summary as
select
  b.agency_id, b.district,
  count(distinct b.id) as building_count,
  count(distinct u.id) as unit_count,
  count(distinct u.id) filter (where u.status = 'occupied') as occupied_count,
  round(100.0 * count(distinct u.id) filter (where u.status = 'occupied') /
        nullif(count(distinct u.id), 0), 1) as occupancy_pct,
  count(distinct mt.id) filter (where mt.status in ('open','in_progress')) as open_tickets
from public.buildings b
left join public.units u on u.building_id = b.id and u.deleted_at is null
left join public.maintenance_tickets mt on mt.unit_id = u.id and mt.deleted_at is null
where b.deleted_at is null
group by b.agency_id, b.district;

-- ============================================================================
-- End of 001_schema.sql
-- ============================================================================
