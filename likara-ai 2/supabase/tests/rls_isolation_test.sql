-- ============================================================================
-- RLS isolation smoke test. Run this against a THROWAWAY/STAGING Supabase
-- project only — never production, it inserts and then rolls back test data,
-- but it's not worth the risk of running against real client data.
--
-- Pattern follows Supabase's documented approach for exercising RLS from SQL:
-- https://supabase.com/docs/guides/database/postgres/row-level-security
-- (`set local role authenticated; set local request.jwt.claims = ...`)
--
-- PREREQUISITE: raw INSERTs into auth.users are unreliable across Supabase
-- versions (extra required columns, identity table wiring) — create FOUR
-- real test users first, via Authentication > Users in the dashboard (or
-- `supabase.auth.admin.createUser` from a script), then paste their UUIDs
-- into the four variables below before running this file:
--   user_a = Agency A admin        user_c = Agency A staff (assigned 1 unit)
--   user_b = Agency B admin        user_d = an owner-portal login
--
-- COVERAGE NOTE: leases, payments, and maintenance_tickets all use the exact
-- same `unit_id in (select id from units where ...)` RLS pattern already
-- exercised here via tenants and expenses — they are not independently
-- re-tested below to keep this script's fixture setup manageable. If you
-- change that shared pattern, re-verify those three tables by hand once.
-- ============================================================================

begin;

-- >>> EDIT THESE FOUR BEFORE RUNNING <<<
-- select set_config('test.user_a_id', '00000000-0000-0000-0000-000000000001', true);
-- select set_config('test.user_b_id', '00000000-0000-0000-0000-000000000002', true);
-- select set_config('test.user_c_id', '00000000-0000-0000-0000-000000000003', true);
-- select set_config('test.user_d_id', '00000000-0000-0000-0000-000000000004', true);
do $$
begin
  if current_setting('test.user_a_id', true) is null
     or current_setting('test.user_b_id', true) is null
     or current_setting('test.user_c_id', true) is null
     or current_setting('test.user_d_id', true) is null
  then
    raise exception 'Set all four test.user_*_id values (see comment above) before running this script.';
  end if;
end $$;

-- ---- Setup ------------------------------------------------------------------
insert into agencies (id, name, email) values
  ('11111111-1111-1111-1111-111111111111', 'Agency A (test)', 'a@test.likara.works'),
  ('22222222-2222-2222-2222-222222222222', 'Agency B (test)', 'b@test.likara.works');

insert into agency_members (agency_id, user_id, role, full_name, email) values
  ('11111111-1111-1111-1111-111111111111', current_setting('test.user_a_id')::uuid, 'admin', 'Admin A', 'a@test.likara.works'),
  ('22222222-2222-2222-2222-222222222222', current_setting('test.user_b_id')::uuid, 'admin', 'Admin B', 'b@test.likara.works'),
  ('11111111-1111-1111-1111-111111111111', current_setting('test.user_c_id')::uuid, 'staff', 'Staff C', 'c@test.likara.works');

insert into buildings (id, agency_id, name_en, address, district, sub_district) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'A Building', '1 Test St', 'Kowloon', 'Mong Kok'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'B Building', '2 Test St', 'Kowloon', 'Mong Kok');

insert into owners (id, agency_id, name_en) values
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Owner One (test)');

insert into owner_portal_users (owner_id, user_id) values
  ('55555555-5555-5555-5555-555555555555', current_setting('test.user_d_id')::uuid);

-- Unit A1: owned by Owner One, staffed by Staff C. Unit A2: neither — the
-- control case that proves scoping actually excludes rows, not just includes them.
insert into units (id, agency_id, building_id, owner_id, unit_number, relationship_manager_id) values
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555', 'A1',
   current_setting('test.user_c_id')::uuid),
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', null, 'A2', null);

insert into tenants (id, agency_id, unit_id, name_en) values
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666666', 'Tenant in A1');

insert into expenses (agency_id, unit_id, owner_id, cost_type, category, type, amount, date_incurred) values
  ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
   '55555555-5555-5555-5555-555555555555', 'owner', 'Repairs', 'variable', 500, '2026-08-01'),
  ('11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
   null, 'agency', 'Software', 'fixed', 1200, '2026-08-01');

-- ---- Test 1: Agency A admin sees exactly its own building -------------------
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
perform set_config('request.jwt.claim.sub', current_setting('test.user_a_id'), true);

do $$
declare visible_count int;
begin
  select count(*) into visible_count from buildings;
  assert visible_count = 1, format('FAIL: Agency A should see exactly 1 building, saw %s', visible_count);

  select count(*) into visible_count from buildings where id = '44444444-4444-4444-4444-444444444444';
  assert visible_count = 0, 'FAIL: Agency A must NOT be able to see Agency B''s building';

  raise notice 'PASS: Agency A admin building isolation verified';
end $$;

-- Test 1b: admin sees BOTH expense rows (owner-cost and agency-cost).
do $$
declare visible_count int;
begin
  select count(*) into visible_count from expenses;
  assert visible_count = 2, format('FAIL: Agency A admin should see 2 expenses, saw %s', visible_count);
  raise notice 'PASS: admin sees all expense rows regardless of cost_type';
end $$;

reset role;

-- ---- Test 2: Agency B admin sees exactly its own building -------------------
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
perform set_config('request.jwt.claim.sub', current_setting('test.user_b_id'), true);

do $$
declare visible_count int;
begin
  select count(*) into visible_count from buildings;
  assert visible_count = 1, format('FAIL: Agency B should see exactly 1 building, saw %s', visible_count);

  select count(*) into visible_count from buildings where id = '33333333-3333-3333-3333-333333333333';
  assert visible_count = 0, 'FAIL: Agency B must NOT be able to see Agency A''s building';

  raise notice 'PASS: Agency B admin isolation verified';
end $$;

reset role;

-- ---- Test 3: Staff C ("my units" scoping) ------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
perform set_config('request.jwt.claim.sub', current_setting('test.user_c_id'), true);

do $$
declare visible_count int;
begin
  -- Staff C is assigned to A1 but NOT A2 — must see exactly 1 unit, not 2.
  select count(*) into visible_count from units where building_id = '33333333-3333-3333-3333-333333333333';
  assert visible_count = 1, format('FAIL: Staff C should see exactly 1 assigned unit, saw %s', visible_count);

  select count(*) into visible_count from units where id = '77777777-7777-7777-7777-777777777777';
  assert visible_count = 0, 'FAIL: Staff C must NOT see unit A2, which is not assigned to them';

  -- Tenant scoping follows unit assignment — same expected result.
  select count(*) into visible_count from tenants;
  assert visible_count = 1, format('FAIL: Staff C should see exactly 1 tenant (via their assigned unit), saw %s', visible_count);

  -- Staff can NEVER see costs, regardless of cost_type — no staff-scoped policy exists at all.
  select count(*) into visible_count from expenses;
  assert visible_count = 0, format('FAIL: Staff must see 0 expenses, saw %s', visible_count);

  raise notice 'PASS: staff "my units" scoping and cost-blindness verified';
end $$;

reset role;

-- ---- Test 4: Owner Portal scoping --------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
perform set_config('request.jwt.claim.sub', current_setting('test.user_d_id'), true);

do $$
declare visible_count int;
begin
  -- Owner One owns unit A1 only — must see exactly 1 unit, not A2.
  select count(*) into visible_count from units where owner_id = '55555555-5555-5555-5555-555555555555';
  assert visible_count = 1, format('FAIL: Owner should see exactly 1 owned unit, saw %s', visible_count);

  select count(*) into visible_count from units where id = '77777777-7777-7777-7777-777777777777';
  assert visible_count = 0, 'FAIL: Owner must NOT see unit A2, which they do not own';

  -- Owner sees their own owner-cost expense but NOT the agency's operating cost.
  select count(*) into visible_count from expenses;
  assert visible_count = 1, format('FAIL: Owner should see exactly 1 (owner-cost) expense, saw %s', visible_count);

  select count(*) into visible_count from expenses where cost_type = 'agency';
  assert visible_count = 0, 'FAIL: Owner must NOT see agency-cost (internal operating) expenses';

  raise notice 'PASS: Owner Portal scoping verified (own units visible, agency costs hidden)';
end $$;

reset role;

-- ---- Test 5: an unauthenticated (anon) session sees nothing ------------------
set local role anon;

do $$
declare visible_count int;
begin
  select count(*) into visible_count from buildings;
  assert visible_count = 0, format('FAIL: anon role should see 0 buildings, saw %s', visible_count);

  select count(*) into visible_count from expenses;
  assert visible_count = 0, format('FAIL: anon role should see 0 expenses, saw %s', visible_count);

  raise notice 'PASS: anonymous access is fully blocked';
end $$;

reset role;

-- Never commit test data into a shared project.
rollback;
