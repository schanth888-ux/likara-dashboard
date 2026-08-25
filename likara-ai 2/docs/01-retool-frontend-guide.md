# Retool Frontend — Build Guide

Mobile-responsive, trilingual (EN/Mandarin/Cantonese), built against the Node API
(`/api/*`) and Supabase Edge Functions (`/functions/v1/*`) described elsewhere in this
repo. This guide is a step-by-step build order — follow it top to bottom for a working
MVP in one sitting.

> **Current plan: build this in Retool now.** Free tier ($0, up to 5 users) covers a
> single pilot agency with no server to stand up or maintain — the fastest, cheapest
> path to a working demo. See [`docs/08-frontend-options.md`](./08-frontend-options.md)
> for when and why to migrate to Appsmith (self-hosted, once you outgrow the free tier
> or add a second paying agency) and eventually Refine.dev. Every page/binding below
> translates directly to Appsmith when that day comes — same drag-drop/query paradigm,
> same resource-and-query mental model — so build with that migration in mind (see the
> "one discipline that makes this cheap" note in that doc) without letting it slow you
> down now.

**Since this guide was first written, a few backend additions change some of the
bindings below** — apply these as you build the relevant page, rather than treating
this file as frozen:
- **CSV export**: every `genericCrudRouter`-backed list (owners, buildings, units,
  tenants, maintenance tickets, expenses, team) now has a matching `GET /api/<table>/export`
  route that returns an audited CSV download. Bind each page's "Export" button to that
  endpoint, not the table component's built-in export — the built-in export never
  touches the API and so never appears in the audit log (P2 requirement).
- **AI Summarize caching**: `POST /api/ai/lease-summary` now returns instantly on a
  cache hit (`cached: true` in the response) — no binding change needed, just don't
  add a client-side loading spinner sized for a 2-second Claude call by default.
- **District score "Recalculate" button**: bind this to
  `POST /api/ai/district-scores/recalculate`, never directly to the
  `district-performance-score` Edge Function — that function requires a secret header
  that must never reach the browser (see `api/src/routes/ai.js`).
- **Brand theme**: apply [`docs/07-brand-theme.md`](./07-brand-theme.md)'s tokens during
  step 0 (App-level setup) below, not as a later polish pass — retrofitting consistent
  colors across 14 already-built pages is much slower than starting with them.
- **Owner Portal** is a separate, smaller app/set of pages (or a separate Retool
  workspace entirely) — see the note at the end of §6 (Owners) below.

## 0. App-level setup (do this first, once)

1. **Create the Retool app** → "Likara AI — Command Centre". Enable **Mobile app** mode
   in app settings so every page gets responsive breakpoints for free.
2. **Resource: Likara API** → REST API resource pointing at your Node API base URL
   (`https://api.likara.works` in production, or your Railway/Render URL). Add a
   default header `Authorization: Bearer {{ current_user.authToken }}` — see step 3.
3. **Resource: Likara Supabase** → Supabase resource (native Retool connector) using
   `SUPABASE_URL` + `SUPABASE_ANON_KEY`, for pages that read views directly
   (`v_rent_roll`, `v_lease_status`, `v_district_summary`) without going through Node.
4. **Auth**: Use Retool's built-in Supabase Auth integration (Settings → Authentication
   → Supabase) so `current_user` carries the Supabase session JWT. Store it in a
   `authToken` custom user attribute for reuse in API headers.
5. **Global state**: create Temporary State variables `selectedDistrict`,
   `selectedBuilding`, `selectedOwner`, `selectedStaff`, `dateRangeStart`,
   `dateRangeEnd` — these back the "Filter Everything" behavior across every page
   (bind each page's filter components to the same global state so filters persist
   as the user navigates, and wire one **"Clear All Filters"** button per page that
   resets all of them).
6. **i18n**: create a JS "translations" module (Retool → Resources → JS libraries, or
   simply a global Temporary State object `i18n = {en: {...}, zh_cn: {...}, zh_hk: {...}}`)
   and a `currentLocale` state variable driven by a language switcher in the top nav.
   Every static label in the app should read `{{ i18n[currentLocale].some_key }}`.

## 1. Dashboard Home

- **District View**: a `districtCards` Query hits Supabase view `v_district_summary`
  (filtered by `agency_id = current_user.agencyId`). Render as a **Listview** of cards:
  building count, unit count, occupancy %, rent collected (join `v_rent_roll` filtered
  to current month + `status='paid'`, summed client-side or via a second query), open
  tickets. Color the card border with a JS expression:
  `occupancy_pct >= 85 ? 'green' : occupancy_pct >= 60 ? 'yellow' : 'red'`.
- Clicking a card sets `selectedDistrict` state and navigates to a filtered view (or
  simply filters the same page's building/unit cards below it — recommended for MVP).
- **KPI Cards** (5 Statistic components): Total Units, Open Tickets, Leases Expiring
  (<60 days, from `v_lease_status`), Rent Collected (this month), Late Rentals
  (`v_rent_roll` `status='late'` count).
- **Quick Action Bar**: 3 buttons opening modals — "Log Ticket" (maintenance_tickets
  insert), "Find Tenant" (search modal hitting `GET /api/tenants?search=`), "Mark Rent
  Paid" (opens Rent Roll filtered to `status != paid`, inline mark-paid button per row).

## 2. Rent Roll

- **Table** bound to `GET /api/payments` (or Supabase view `v_rent_roll` directly for
  read performance). Columns: Unit, Building, Tenant, Rent, Due Day, Status.
- Status column: custom cell renderer — badge colored green/paid, red/late, grey/upcoming.
- **Filters** (top of page, all wired to global state + query params): Building
  (multi-select dropdown, source = distinct `buildings.name_en`), Unit (search),
  Status (dropdown), Staff (dropdown, admin-only — filters `relationship_manager_id`).
  "Clear All Filters" button resets every filter component to its default.
- **"Mark as Paid"** button per row → `POST /api/payments/{{ row.id }}/mark-paid` with a
  small confirm modal for payment method. On success, refresh the table query.

## 3. Maintenance Tickets

- **View toggle**: Table view / Kanban view (Retool Kanban component, or a 3-column
  Container layout with drag handlers if using open-source Kanban block).
  Columns: Open → In Progress → Completed, mapped to `maintenance_tickets.status`.
  On drop, fire `PATCH /api/maintenance-tickets/{{ id }}` with the new status
  (set `resolved_at = now()` when dropped into Completed).
- **"Add Ticket" modal**: Unit dropdown (searchable), Issue text areas (EN + ZH — two
  fields, or one field with a "Translate" button that calls
  `POST /api/ai/maintenance-triage` to backfill all three language fields and
  auto-suggest priority/vendor), Channel dropdown, Photo Upload (Retool FilePicker →
  upload to Supabase Storage bucket `ticket-photos` → store returned URL in `photo_url`),
  Vendor dropdown (seeded from distinct `vendor_assigned` values + the AI suggestion).
- **AI Triage button**: on issue text blur, call `POST /api/ai/maintenance-triage`,
  populate priority + vendor_type fields with the suggestion (user can override).
- Filters: Building, Unit, Priority, Status, Channel, Staff, Date Range.

## 4. Leases

- **Table**: Unit, Tenant, Rent, Due Day, Start Date, End Date, Days Remaining
  (from `v_lease_status`). Row background/left-border colored by `expiry_flag`
  (red/yellow/green) — bind container style to the row's `expiry_flag` value.
- **"Renew Lease"** button → `POST /api/leases/{{ row.lease_id }}/renew`, opens a small
  modal to override rent/dates if needed, then refreshes the table.
- **"AI Summarize"** button → `POST /api/ai/lease-summary { lease_id }`, opens a modal
  with three tabs (EN / 普通话 / 廣東話) showing the trilingual summary.
- **Lease document upload**: FilePicker → `POST /api/leases/{{ id }}/document-upload-url`
  to get a signed URL, PUT the file directly to Supabase Storage, then
  `PATCH /api/leases/{{ id }}` with `lease_document_url` + `lease_document_name`.
- Filters: Building, Unit, Tenant, Status, Due Day, Owner, Staff.

## 5. Tenants

- Table: Name (EN/ZH), Unit, Building, Phone, Email, Lease End (join `v_lease_status`).
- Search box hits `GET /api/tenants?search=` (ILIKE across `name_en`, `name_zh`, `phone`).
- "Add Tenant" modal: standard form → `POST /api/tenants`.
- Filters: Building, Unit, Tenant Name, Status (derived from unit status), Owner, Staff.

## 6. Owners

- Table: Name, Phone, Email, Buildings (count), Units (count), Total Rent (sum of
  active leases' `rent_amount` for units owned). Build via a Supabase query joining
  `owners` → `buildings`/`units` → `leases`, or a dedicated view `v_owner_summary`
  (add to `supabase/migrations/20260101000001_schema.sql` if the client needs it beyond MVP).
- "Add Owner" modal → `POST /api/owners`.
- "Owner-specific report" button → `POST /api/ai/monthly-report { agency_id, owner_id }`.
- Filters: Owner Name, District (via buildings join), Building Count, Unit Count.
- **"Invite to Owner Portal"** button per row (admin only) → modal for the owner's
  email → `POST /api/owner-portal/invite { owner_id, email }`. This sends a Supabase
  magic-link invite and grants that login read-only access to just this owner's
  buildings/units/tenants/leases/payments/tickets and their own owner-attributed
  expenses (see `supabase/migrations/20260101000004_owner_portal.sql`). Build the Owner Portal itself as a
  **separate, much smaller app** (3-4 pages: portfolio summary, buildings/units list,
  rent history, maintenance activity) pointed at the same Supabase resource — don't
  try to reuse the agency-staff pages, they assume `agency_members` context an owner
  session doesn't have. `GET /api/owner-portal/my-summary` gives you the portfolio
  summary page's data in one call.

## 7. Units

- Table: Unit, Building, Owner, Tenant (current), Status, Manager (relationship_manager_id
  resolved to `agency_members.full_name`).
- "Assign Staff" dropdown per row → `PATCH /api/units/{{ id }} { relationship_manager_id }`.
- "Add Unit" modal → `POST /api/units`.
- Filters: Building, Owner, Status, Staff, District (via building join).
- **"My Units"** toggle (staff only, hidden for admin): filters table to
  `relationship_manager_id = current_user.id` — bind visibility of the toggle to
  `current_user.role !== 'admin'`.

## 8. Financial Dashboard (MVP)

- 3 KPI cards only, per spec: Total Rent Collected (this month), Late Rentals (count),
  Leases Expiring (count, <60 days). All admin + staff visible (these three numbers are
  not "costs", so they're allowed for staff per the spec's cost-visibility rule).
- Full P&L / expense charts are explicitly Phase 2 — do not build them into this page.

## 9. Expenses (Admin only — enforce via page-level Retool permission + `requireAdmin` on `/api/expenses`)

- Table: Cost Type, Category, Type, Amount, Description, Date, Unit, Building, Owner.
- "Add Expense" modal, with a **Fixed vs Variable** toggle: Fixed costs get
  `recurring_monthly = true` and are auto-applied every month (implement via a small
  monthly cron in the Node API that clones fixed expenses forward — see
  `docs/03-deployment-guide.md` "Recurring expense cron").
- Filters: Cost Type, Category, Type, Date Range, Unit, Building, Owner.
- **Hide this entire page from the nav for non-admin users** (Retool page visibility
  rule: `current_user.role === 'admin'`) — this is UX only; RLS + `requireAdmin` are
  the real enforcement.

## 10. AI Insights

- **Smart Search bar**: single text input + "Search" button →
  `POST /api/ai/smart-search { question }`. Render `results` as a dynamic table
  (Retool JSON-to-table component) plus the trilingual `explanation_*` as a caption.
- **Anomaly alerts feed**: `GET /api/ai/anomaly-alerts?is_resolved=false`, rendered as
  a list of dismissible cards colored by `severity`, showing the language matching
  `currentLocale`. "Resolve" button → `PATCH /api/ai/anomaly-alerts/{{ id }}/resolve`.
- **District scores**: bar chart from `GET /api/ai/district-scores`.
- **"Generate Monthly Report"** button → month picker + owner picker (optional) →
  `POST /api/ai/monthly-report { agency_id, month, owner_id }` → render the three
  language tabs, with a "Download PDF" button (see PDF rendering notes in
  `docs/03-deployment-guide.md`).

## 11. Data Import

- Step 1: FilePicker (`accept=".pdf,.xlsx,.xls,.csv,.docx,.jpg,.jpeg,.png"`) →
  `POST /api/import/upload` (multipart) with `agency_id`.
- Step 2: Show `detected_data_type`, `confidence`, and `column_mapping` as an editable
  key-value table (source column → dropdown of canonical fields, pre-selected from AI).
- Step 3: Preview table of `preview_rows`, editable inline; highlight rows referenced
  in `validation_warnings` in yellow.
- Step 4: "Confirm Import" button → `POST /api/import/{{ id }}/confirm-all` then
  `POST /api/import/{{ id }}/confirm { agency_id }`. Show a results summary
  (`inserted` / `failed` counts + per-row errors).

## 12. Team Management (Admin only)

- Table bound to `GET /api/team`. "Invite" button opens a modal that calls Supabase
  Auth Admin (`supabase.auth.admin.inviteUserByEmail`, exposed via a small
  `POST /api/team/invite` Node endpoint you add — service-role only, never client-side)
  then inserts the `agency_members` row.
- "Assign staff to units" — reuse the Units page's per-row "Assign Staff" dropdown;
  optionally add a bulk-assign modal here for onboarding a new hire onto many units at once.

## 13. My Profile

- Change password: Supabase Auth `updateUser({ password })`, called directly via the
  Supabase resource (native Retool connector), no need to route through Node.
- Enable 2FA: Supabase Auth MFA enrollment flow (`supabase.auth.mfa.enroll`) — Retool
  can call this via a Custom Component or a lightweight JS Query using the Supabase JS
  client loaded as a library resource. Show the QR code image returned, then verify
  with `supabase.auth.mfa.challengeAndVerify`.

## 14. In-Dashboard User Guide (cross-cutting)

- **Welcome Modal**: on first login (check `agency_members.created_at` vs. a
  `has_seen_welcome` flag you add to that table, or store in `localStorage` via
  Retool's browser storage), show a 3-step modal: "Log a ticket", "Add a tenant",
  "View your portfolio" — each step a static screenshot + "Next"/"Skip".
- **Help Button**: a fixed-position floating "?" Retool container
  (`position: fixed; bottom: 20px; right: 20px`) present on every page (use a
  Retool **Module** so it's defined once and embedded everywhere) opening a drawer
  with links: User Guide, Video Tutorials, Contact Support (mailto:hello@likara.works),
  FAQ.
- **Contextual tooltips**: small "?" icon components next to Smart Search, Add Ticket,
  AI Summarize etc. — Retool Tooltip component, content pulled from the `i18n` module
  so tooltips are trilingual too.
- **Help Center page**: static FAQ accordion + embedded video links + a contact form
  that inserts into a lightweight `support_requests` table (add if needed) or simply
  `mailto:` for MVP.

## Mobile responsiveness checklist

- Use Retool's **Mobile Layout** mode; test every page at the 375px breakpoint.
- Tables → switch to **Listview** on mobile (Retool responsive container swap, or a
  `{{ !mobileScreen }}` visibility condition switching Table vs. Listview components).
- Kanban board → collapse to a status-filtered single-column list on mobile with a
  segmented control to switch status.
- Filter bars → collapse into a single "Filters" drawer button on mobile, do not show
  8 dropdowns inline on a phone screen.
