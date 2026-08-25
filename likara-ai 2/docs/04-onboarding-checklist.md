# Onboarding Checklist — First HK Client

Target: a 5-building, ~100-unit agency going from signed contract to live dashboard.
Estimated timeline: **3–5 business days** for a clean data set; add 2–3 days if most
data arrives as scanned PDFs or messy spreadsheets requiring the Universal Importer's
manual-correction path.

## Day 0 — Contract & setup

- [ ] Sign DPA (Data Processing Agreement) — required before any client data touches
      the system, per HK PDPO.
- [ ] Create the agency's row in `agencies` (name, email, phone, `subscription_tier`).
- [ ] Create the first `agency_members` row for the agency's designated admin
      (usually the principal/office manager) with `role = 'admin'`.
- [ ] Send the admin a Magic Link invitation to set their password + enroll 2FA.
- [ ] Confirm the admin can log in, sees an empty dashboard, and 2FA is enforced.

## Day 1 — Data collection

Collect whatever the agency already has, in whatever format it's in — that's the
point of the Universal Importer. Typical sources for a 100-unit agency:
- [ ] Building list (names, addresses, districts) — often just in the agent's head or
      an old Excel sheet.
- [ ] Unit list per building (unit numbers, floors, sizes if available).
- [ ] Owner contact list.
- [ ] Current tenant list + contact details.
- [ ] Active leases — PDFs, Word docs, or a spreadsheet of terms.
- [ ] Recent rent payment history if they want it pre-loaded (optional for MVP —
      can start clean from go-live date instead).
- [ ] Open maintenance issues, if any are currently being tracked anywhere.

## Day 2 — Import

Recommended import order (respects foreign-key dependencies, minimizes auto-created
placeholder rows):
1. [ ] **Buildings** — import first so districts/addresses are correct from the start
       rather than relying on auto-created "TBD" placeholders.
2. [ ] **Units** — references buildings by name.
3. [ ] **Owners** — independent, import any time before buildings/units if you want
       owner_id populated on first pass (otherwise link afterward via the Units page).
4. [ ] **Tenants** — references units.
5. [ ] **Leases** — references tenants + units; import last among the core entities.
6. [ ] **Maintenance Tickets** (if any open ones exist) — references units.

For each file: upload via Data Import page → review the AI-suggested mapping
carefully (Chinese/English mixed columns are the most common source of a wrong
mapping) → fix any flagged `validation_warnings` → confirm.

- [ ] Spot-check 5–10 imported records against the source file for accuracy.
- [ ] Fix any buildings that were auto-created with placeholder district/address
      (Buildings page → filter for `address` starting with "TBD").

## Day 3 — Configuration

- [ ] Assign relationship managers ("My Units") per unit if the agency has multiple
      staff — Units page → "Assign Staff" dropdown per row, or bulk via Team Management.
- [ ] Invite remaining staff accounts (`role = 'staff'`), confirm they only see their
      assigned units after logging in.
- [ ] Configure fixed monthly expenses if the agency wants agency-cost tracking from
      day one (staff salaries, software, office rent) — Expenses page, admin only.
- [ ] Run `POST /api/payments/generate-monthly` once for the current month so the
      Rent Roll page is populated immediately rather than waiting for the 1st.
- [ ] Verify anomaly detection and district scores have run at least once
      (`GET /api/ai/district-scores`, `GET /api/ai/anomaly-alerts`) — if same-day,
      trigger manually via the Edge Functions rather than waiting for 09:00 HKT.

## Day 4 — Training

- [ ] Walk the admin through the Welcome Modal's 3 flows live: log a ticket, add a
      tenant, view the portfolio.
- [ ] Demo AI Smart Search with 3-5 real questions about their own portfolio (far more
      convincing than generic examples).
- [ ] Demo AI Lease Summarizer on one of their actual imported leases.
- [ ] Show the Help Center page and floating "?" button.
- [ ] Confirm the admin knows how to invite additional staff themselves going forward.

## Day 5 — Go live

- [ ] Agency stops using their old spreadsheet/system for new records as of this date.
- [ ] Confirm rent roll "Mark as Paid" is being used for this month's incoming payments.
- [ ] Schedule a 2-week check-in call to review adoption and gather feedback.
- [ ] Confirm billing is set up per the agreed package/tier (see cost estimate doc).

## Success criteria for this onboarding (tie back to product success criteria)

- [ ] Dashboard loads in under 2 seconds for the admin on a normal HK broadband/mobile
      connection.
- [ ] Every list page's filters have been tried at least once by the admin during training.
- [ ] The agency reports (anecdotally, at the 2-week check-in) that they've stopped
      opening their old spreadsheet for daily rent/ticket tracking — this is the "10
      hours/week saved" signal in practice, not a formal time-study.
