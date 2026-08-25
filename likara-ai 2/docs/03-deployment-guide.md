# Deployment Guide — Supabase + Retool + Netlify

Target: production-ready MVP for a single pilot agency (5 buildings, 100 units) in
under a day of setup work. All steps assume you're working from this repo root.

## 1. Supabase project

1. Create a new project at [supabase.com](https://supabase.com) → **Region: Southeast
   Asia (Singapore)** — lowest latency to Hong Kong of the available Supabase regions.
2. In **Database → Extensions**, enable: `pgcrypto`, `pg_trgm`, `pg_cron`, `pg_net`.
3. Run the SQL migrations, via the Supabase CLI (recommended — applies every file
   under `supabase/migrations/` in filename order, which is why they're timestamp-prefixed):
   ```bash
   supabase link --project-ref <your-project-ref>
   ```
   ```bash
   supabase db push
   ```
   No `--file` flag, and no need to list the four migration files individually — `db push`
   discovers and applies everything in `supabase/migrations/` itself. (If you prefer the
   SQL Editor instead of the CLI, run the four files from that folder in order by hand —
   `20260101000001_schema.sql` through `...000004_owner_portal.sql`.)

   `scripts/apply_cron_schedules.sql` and `supabase/tests/rls_isolation_test.sql` are
   deliberately **not** in `supabase/migrations/` and won't be touched by `db push` —
   the first is a one-time operational script with placeholders to fill in (run it
   manually, after Edge Functions are deployed in step 3 below), the second is a test
   script for staging only (see its own header comment) — neither belongs in the
   reproducible schema-migration history.
4. **Storage buckets** — create three buckets (Storage → New bucket), all **private**:
   - `lease-documents`
   - `ticket-photos`
   - `import-uploads`
   Add a storage policy on each restricting access to authenticated users whose
   `agency_id` (looked up via `agency_members`) matches the object path's first
   path segment — mirror the RLS pattern already used for tables:
   ```sql
   create policy "agency_scoped_read" on storage.objects for select
     using (bucket_id = 'lease-documents' and (storage.foldername(name))[1] = auth_agency_id()::text);
   ```
   Repeat per bucket, adjusting `bucket_id`.
5. **Auth settings** (Authentication → Settings):
   - Enable **Email + Password**.
   - Enable **Magic Link** (used for first-time invitations and password resets).
   - Under **Multi-Factor Auth**, enable **TOTP**. Enforce it per-user via the
     `agency_members.role = 'admin'` check in your onboarding flow (Supabase Auth
     doesn't have a native "require MFA for role X" toggle — gate this at the
     application layer: Retool checks `mfa_enrolled` before allowing an admin past
     login, and the Node API's `requireAdmin` middleware can additionally check
     `req.user.factors?.length > 0`).
   - Set **JWT expiry** to 30 minutes and enable refresh tokens, to support the
     15–30 minute inactivity session-timeout requirement (pair with a Retool-side
     idle timer that calls `supabase.auth.signOut()` after 15 min of no interaction).

## 2. Environment variables / secrets

Set these as Supabase Edge Function secrets (`supabase secrets set KEY=value`):

```bash
supabase secrets set CLAUDE_API_KEY=sk-ant-...
supabase secrets set CRON_SECRET=<generate a long random string>
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set SENTRY_DSN=https://...@sentry.io/...
```

`RESEND_API_KEY` powers the high-severity anomaly alert emails (see
`supabase/functions/_shared/email.ts`) — get one free at resend.com; verify the
`likara.works` sending domain before going live, unverified domains are rate-limited.
`SENTRY_DSN` is optional (functions run fine without it, just unreported on error) —
create a free Sentry project and set this once you want error visibility, which you
should before onboarding a real client.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically into every Edge Function — you don't set these yourself.

For the Node API, copy [`api/.env.example`](../api/.env.example) to `api/.env` and fill
in the same `CLAUDE_API_KEY`, plus your project's `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).

**Production hardening not yet in the sample code:** add a `x-cron-secret` header check
at the top of `anomaly-detection-cron` and `district-performance-score` comparing
against `Deno.env.get("CRON_SECRET")`, since both currently rely only on
`verify_jwt=false` + obscurity. This is a 3-line addition — do it before go-live.

## 3. Deploy Edge Functions

```bash
supabase functions deploy lease-summarizer
supabase functions deploy maintenance-triage
supabase functions deploy smart-search
supabase functions deploy generate-monthly-report
supabase functions deploy universal-importer-extract
supabase functions deploy anomaly-detection-cron --no-verify-jwt
supabase functions deploy district-performance-score --no-verify-jwt
```

Then run `scripts/apply_cron_schedules.sql` in the SQL Editor (after substituting your
project ref and cron secret) to wire the 09:00 / 09:15 HKT daily triggers.

## 4. Node API deployment

Any Node 20+ host works. For an MVP, **Railway** or **Render** (both have generous free
tiers and a one-click GitHub deploy) are the fastest path:

1. Push the `api/` directory to its own GitHub repo (or deploy the monorepo with a
   root directory override pointing at `api/`).
2. Set the environment variables from `api/.env.example` in the host's dashboard —
   including `CRON_SECRET` (same value as the Supabase secret above, needed for the
   district-score "Recalculate" button proxy) and `SENTRY_DSN`. The `DOCUSIGN_*`
   vars can stay blank until you've actually set up a DocuSign sandbox — the
   e-signature feature is a scaffold (see `api/src/services/esignService.js`),
   not required for MVP go-live.
3. Build command: `npm install`. Start command: `npm start`.
4. **Install the PDF-rasterization binaries** on the host — required for the
   scanned-PDF fallback path (`api/src/services/importerService.js`'s
   `ocrScannedPdf`). OCR itself runs via `tesseract.js` (WASM, in-process — no
   binary needed, and deliberately not `node-tesseract-ocr`, which shells out
   and carries an unpatched critical CVE, see that file's comments). On
   Railway/Render, add an `apt.txt` containing:
   ```
   graphicsmagick
   ghostscript
   ```
   Without these, scanned PDFs fail at the rasterization step even though
   plain JPG/PNG OCR and born-digital PDFs still work fine.
   **`tesseract.js` downloads its language data (`eng`/`chi_sim`/`chi_tra`
   `.traineddata` files, tens of MB) from its CDN on first use by default.**
   If the host has no outbound internet access at runtime, or you want
   predictable cold-start latency, pre-download those files and set
   `TESSERACT_LANG_PATH` to point at a local directory instead — see
   tesseract.js's docs for the exact filenames.
5. Point Retool's "Likara API" resource base URL at the deployed host
   (`https://<your-app>.up.railway.app` or your custom domain, e.g. `api.likara.works`).

## 5. Retool

1. Sign up / log in at retool.com, create a new app in the **Free tier** (sufficient
   for MVP — see cost estimate doc).
2. Add the two resources (Likara API REST resource, Likara Supabase resource) as
   described in [`docs/01-retool-frontend-guide.md`](./01-retool-frontend-guide.md) §0.
3. Build pages per that guide, section by section.
4. **Mobile**: Retool apps built in "Mobile app" mode are automatically responsive and
   accessible via the Retool Mobile app or a mobile browser — no separate build needed.
5. Set the org-level session timeout (Retool → Settings → Security) to 30 minutes.

## 6. Netlify (only if you build a custom marketing site / public-facing pages)

Not required for the dashboard itself (that's 100% Retool). Use Netlify only for:
- `likara.works` marketing site.
- Any standalone PDPO Privacy Policy / DPA static pages you want at
  `likara.works/privacy`, `likara.works/dpa`.

Deploy: connect the site's repo to Netlify, build command per your static site
generator (or none, for plain HTML), free tier is sufficient at this scale.

## 7. PDF rendering options (for "AI Summarize" and "Generate Monthly Report")

The Edge Functions return trilingual **text/JSON**, not PDF bytes. Two supported paths:

- **Client-side (fastest to ship)**: Retool's PDF component / `jsPDF` custom JS query
  renders the returned text into a styled PDF in-browser, triggers a download. No new
  infrastructure.
- **Server-side (nicer output)**: add a small `POST /api/reports/render-pdf` Node
  endpoint using `puppeteer` or `@react-pdf/renderer` to turn an HTML/JSX template +
  the report JSON into a branded PDF with the Likara AI header/logo, then upload it to
  a `reports` Storage bucket and return a signed URL. Recommended once the pilot client
  wants distributable, branded PDFs (not required for MVP demo).

## 8. Recurring expense cron (Fixed costs)

Fixed expenses (`expenses.recurring_monthly = true`) should clone forward each month.
Add a small scheduled Node job or a `pg_cron` + `pg_net` trigger (same pattern as
`scripts/apply_cron_schedules.sql`) hitting a new `POST /api/expenses/roll-forward` endpoint
on the 1st of each month HKT that copies every `recurring_monthly=true` expense row
with `date_incurred` bumped to the new month. This is a Phase 1.1 nice-to-have, not
required for the initial 100-unit pilot demo.

## 9. Service-role usage policy

The service-role key bypasses RLS. It is used in exactly three places in this
codebase, and every use manually scopes by `agency_id`:
1. `anomaly-detection-cron` — must scan across all agencies.
2. `district-performance-score` — same.
3. `importerService.createImportJob` — the job row must exist before the uploader's
   RLS-scoped session can safely reference it.
Never introduce a fourth use without the same "manually filter by agency_id, every
query, no exceptions" discipline — it is the one place a bug could leak cross-tenant data.

## 9.5. Testing & staging (do this before onboarding a real client)

- **Automated tests**: `cd api && npm install && npm test` runs the Vitest suite
  (`api/tests/*.test.js`) — pure-function coverage for the rent-roll due-date math,
  lease renewal date math, HK phone/amount normalization, CSV export, and file-type
  detection. `.github/workflows/ci.yml` runs this on every push/PR automatically.
- **RLS isolation test**: `.github/workflows/ci.yml`'s `rls-isolation` job spins up
  a local Supabase instance in CI and runs `supabase/tests/rls_isolation_test.sql`
  against it — this is the test that actually proves Agency A cannot see Agency B's
  data, rather than relying on manual inspection. Its exact CLI invocations
  haven't been run end-to-end against a live GitHub Actions runner yet; treat the
  first real CI run as verification, and fix any command-syntax drift you hit
  against current Supabase CLI docs rather than assuming the SQL itself is wrong.
- **Staging environment**: create a second Supabase project ("likara-ai-staging")
  and a second Appsmith/Retool app pointed at it, mirroring steps 1–15 of Part A
  above with `-staging` in the names. Every schema change or Edge Function
  deploy goes here first. This is what stands between "I tested it on my laptop"
  and "a real client's rent roll broke."
- **Point-in-time recovery**: on Supabase's paid tier, enable PITR (Database →
  Backups) and actually perform one test restore into a scratch project before
  you're relying on it for a real client — an untested backup is not a backup.

## 10. Go-live checklist

- [ ] `supabase db push` applied all 4 files under `supabase/migrations/`, then
      `scripts/apply_cron_schedules.sql` run manually last (after Edge Functions are
      deployed). `select * from pg_policies where schemaname='public'` shows RLS
      policies on every table, including the owner-portal SELECT policies from
      `20260101000004_owner_portal.sql`.
- [ ] Storage bucket policies applied and tested with a non-admin staff account.
- [ ] Edge Function secrets set (`CLAUDE_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY`,
      `SENTRY_DSN`).
- [ ] Cron jobs visible in `select * from cron.job;` and firing (`cron.job_run_details`);
      confirm both cron functions reject a request missing `x-cron-secret` (`curl` them
      with no header and confirm a 401).
- [ ] `npm test` passes in `api/`; CI is green on the repo's default branch.
- [ ] `supabase/tests/rls_isolation_test.sql` has been run at least once against staging
      (not production) and all six PASS notices printed (admin isolation ×2 + admin
      cost visibility, staff "my units" scoping + cost-blindness, owner-portal
      scoping, anonymous access blocked).
- [ ] Node API `/health` returns 200 from the deployed host; a deliberate
      `throw`-triggering test request shows up in Sentry (if configured).
- [ ] Retool/Appsmith resources connected, at least one full page (Rent Roll) working
      end-to-end.
- [ ] 2FA enforced for the pilot agency's admin account.
- [ ] Privacy Policy + DPA pages live at likara.works.
- [ ] If offering owner portal access: one real owner invited via
      `POST /api/owner-portal/invite`, logged in, and confirmed they see only their
      own buildings/units/rent — not another owner's.
