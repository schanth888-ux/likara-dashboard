# Likara AI — Property Command Centre

**"Bringing Light to Property Management"** — a unit-first B2B SaaS platform for Hong
Kong property agencies. Built for a 5-building, 100-unit pilot agency as the MVP
target scale, architected to scale to 10 agencies × 1,000 units without redesign.

- **Domain:** likara.works · **Dashboard:** dashboard.likara.works · **Email:** hello@likara.works
- **Frontend:** Retool (mobile-responsive) — free tier, $0, zero infra to manage, right
  choice for the first pilot agency. Staged migration to Appsmith (self-hosted, once you
  outgrow the free tier) and later a custom Next.js/Refine.dev app (once product-market
  fit is confirmed) — see `docs/08-frontend-options.md` for the full reasoning and the
  specific triggers for each move.
- **DB:** Supabase Postgres + RLS
- **AI:** Claude (Haiku for structured/simple tasks, Sonnet for reasoning)
- **Timezone:** Asia/Hong_Kong (UTC+8) everywhere, no exceptions
- **Trilingual:** every AI output ships in English + Simplified Mandarin + Traditional
  (Hong Kong) Cantonese, generated in a single call, never machine-translated
  sequentially between languages

## Repository map

```
supabase/migrations/               Database schema, RLS policies, Smart Search RPC — the
                                    standard Supabase CLI convention (`supabase db push`
                                    applies every file here, in filename order, no --file
                                    flag needed)
  20260101000001_schema.sql          All tables, indexes, soft delete, RLS, views
  20260101000002_smart_search_support.sql  Read-only SQL execution RPC for AI Smart Search
  20260101000003_ai_output_cache.sql       Lease summary caching + auto-invalidation trigger
  20260101000004_owner_portal.sql          Owner Portal: owner_portal_users table + RLS

supabase/tests/rls_isolation_test.sql   Cross-tenant isolation test — staging/CI only, never prod
scripts/apply_cron_schedules.sql        09:00 HKT daily job wiring (pg_cron+pg_net) — one-time,
                                         manual, run AFTER Edge Functions are deployed; not a
                                         migration (has placeholders, isn't reproducible as-is)

supabase/functions/               Edge Functions (Deno) — AI features, co-located with DB
  lease-summarizer/                 Trilingual one-page lease summary (Haiku), now cached
  maintenance-triage/               Priority + vendor suggestion (Haiku)
  smart-search/                     NL → SQL → results (Sonnet, RLS-enforced execution)
  generate-monthly-report/          Trilingual monthly report narrative (Sonnet)
  universal-importer-extract/       AI column mapping for the Universal Importer (Sonnet)
  anomaly-detection-cron/           Daily 09:00 HKT: late rent, repeated tickets, occupancy
                                     drop — now also emails admins on HIGH-severity alerts
  district-performance-score/       Daily 09:15 HKT: 0-100 composite score per district
  _shared/                          cors.ts, supabaseAdmin.ts, claude.ts, sentry.ts, email.ts

api/                               Node.js API — reusable business-logic layer.
                                    Used by the frontend today; designed to be mounted
                                    unchanged behind the Phase 2 WhatsApp bot webhook, per
                                    the "DO NOT BUILD THE WHATSAPP BOT YET" constraint.
  src/index.js                      Express app entrypoint (Sentry-wrapped)
  src/lib/                          Supabase clients, Claude client, Edge Function proxy,
                                     Sentry init, CSV export helper
  src/middleware/auth.js            JWT → RLS-scoped client + role guard
  src/services/                     rentRollService, leaseService, importerService (now with
                                     scanned-PDF OCR fallback), importResolverService,
                                     auditService, esignService (DocuSign scaffold)
  src/routes/                       entities (generic CRUD + audited CSV export), leases
                                     (+ renew, + send-for-signature), payments, import, ai
                                     (+ district-score recalculate proxy), ownerPortal
  tests/                            Vitest unit tests for every pure-logic helper above

.github/workflows/ci.yml          Runs `npm test` + the RLS isolation test on every push/PR

prompts/                           Canonical, versioned Claude prompt templates (trilingual)

docs/
  01-retool-frontend-guide.md       Page-by-page low-code build guide (Appsmith or Retool)
  02-universal-data-importer.md     Importer architecture, HK-specific mapping rules, OCR fallback
  03-deployment-guide.md            Supabase + frontend + Netlify deployment, go-live checklist
  04-onboarding-checklist.md        Day-by-day first-client onboarding plan
  05-cost-estimate.md               Monthly cost breakdown, 1 agency and 5 agencies
  06-sales-pitch-script.md          Discovery call + live demo script
  07-brand-theme.md                 Placeholder brand tokens + Appsmith custom-CSS injection
  08-frontend-options.md            Staged plan: Retool now → Appsmith → Refine.dev, and how to migrate cheaply
```

## Core design decisions worth knowing before you extend this

1. **Unit-first, always.** Every entity that isn't a building or an owner links to
   `unit_id`, not `building_id`. See `supabase/migrations/20260101000001_schema.sql` for the hierarchy comments.
2. **RLS is the real security boundary**, not application code. `agency_id` isolation,
   staff "my assigned units only" scoping, and owner-portal scoping are all enforced by
   Postgres policies (`auth_agency_id()`, `auth_is_admin()`, `auth_is_assigned_to_unit()`,
   `auth_owner_id()`). The Node API's `req.supabase` client always carries the caller's
   JWT specifically so this holds — never swap it for the service-role client outside
   the documented exceptions (deployment guide §9). `supabase/tests/rls_isolation_test.sql`
   is the automated proof of this, run in CI.
3. **Expenses are admin-only at the database level for AGENCY costs**, not just hidden
   in the UI — `expenses_admin_only` RLS policy blocks staff reads entirely. Owners can
   additionally see their own `cost_type='owner'` expenses via the Owner Portal policy —
   a deliberate, documented narrowing of "admin-only," see `supabase/migrations/20260101000004_owner_portal.sql`.
4. **AI Smart Search executes AI-generated SQL through the caller's own RLS-scoped
   session**, inside a function forced read-only, with a keyword denylist as
   defense-in-depth. A hallucinated or malicious query still cannot see another
   agency's data. See the security note at the top of
   `supabase/functions/smart-search/index.ts`.
5. **Model selection is a rule, not a preference**: Haiku for structured/simple tasks,
   Sonnet for genuine reasoning (NL→SQL, messy spreadsheet mapping, report synthesis).
   See `prompts/README.md`.
6. **Trilingual output is one Claude call, not three.** Every prompt template returns
   `_en` / `_zh_cn` / `_zh_hk` in a single JSON response for consistency and cost.
7. **The Node API exists so the WhatsApp bot never duplicates business logic.**
   Rent-roll generation, lease renewal, and the importer's insert/resolve logic all
   live in `api/src/services/*`, callable from the frontend now and from a bot webhook
   later without rewriting anything. The bot itself is explicitly **not** built here.
8. **Secrets used by cron-invoked Edge Functions never reach the browser.** Both
   `anomaly-detection-cron` and `district-performance-score` are deployed with
   `--no-verify-jwt` (pg_cron has no user session) and gated by `CRON_SECRET` instead.
   The "Recalculate" button in the frontend calls the Node API's
   `POST /api/ai/district-scores/recalculate` proxy, which holds that secret
   server-side — never wire a browser-side button directly to a `--no-verify-jwt`
   function with the secret embedded in the request.
9. **AI outputs are cached, not regenerated on every click.** Lease summaries write
   back onto `leases.ai_summary_*`, invalidated automatically by a DB trigger whenever
   summary-relevant fields change — this holds regardless of which client edits the
   lease (Node API or a low-code tool talking to Supabase directly).
10. **What's fully built vs. scaffolded, honestly:** SQL/RLS, Edge Functions, and the
    Node API's core routes are complete and internally consistent but have not been
    executed against a live Supabase project. The e-signature integration
    (`api/src/services/esignService.js`) is explicitly a scaffold, never run against a
    real DocuSign account — read its header comment before wiring it into a production
    button.

## Getting started

1. Follow [`docs/03-deployment-guide.md`](./docs/03-deployment-guide.md) top to bottom.
2. Then [`docs/01-retool-frontend-guide.md`](./docs/01-retool-frontend-guide.md) to
   build the dashboard pages (works for Appsmith or Retool — the bindings are
   equivalent), applying [`docs/07-brand-theme.md`](./docs/07-brand-theme.md)'s tokens
   as you go rather than as an afterthought.
3. Then [`docs/04-onboarding-checklist.md`](./docs/04-onboarding-checklist.md) to bring
   on your first real client.
4. Before that first real client: run `npm test` in `api/`, confirm CI is green, and
   run the RLS isolation test against staging — see deployment guide §9.5.

## Success criteria (from product spec — track against these)

- [ ] Dashboard loads in <2s
- [ ] Works cleanly on phone-sized viewports
- [ ] Every AI output is trilingual
- [ ] Every entity traces back to a unit
- [ ] Every table column is filterable
- [ ] RLS + 2FA (admin required) + audit logs + DPA all live before first client data loads
- [ ] Automated tests passing in CI + one verified RLS isolation run + one verified
      backup restore before the first paying client's data loads
