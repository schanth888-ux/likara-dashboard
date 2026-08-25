# Frontend Options — Retool Now, Appsmith Next, Refine.dev Later

This repo's SQL/RLS/Edge Functions/Node API are 100% frontend-agnostic — any tool
below just needs to call Supabase directly (respecting RLS via the user's JWT) or hit
the Node API's REST endpoints. Switching frontends costs zero backend rework, provided
one discipline is followed throughout (see the bottom of this doc).

## The staged plan

| Stage | Tool | Trigger to move to it | Trigger to move off it |
|---|---|---|---|
| 1 (now) | **Retool**, free tier | Day one — cheapest, fastest, zero infra | Either you exceed 5 end users, **or** you sign a 2nd paying agency, whichever comes first |
| 2 | **Appsmith**, self-hosted | Free-tier ceiling hit | 3+ paying agencies and confirmed product-market fit |
| 3 | **Next.js + Refine.dev** | PMF confirmed, ready to invest in a permanent product surface | — this is the long-term destination |

## Why Retool first, specifically

Retool's free tier is genuinely $0 for up to 5 users (builder + end users combined) —
for a single 5-building/100-unit pilot agency with a handful of staff, that's likely
enough to run the entire first client on, with no VM to provision, patch, or monitor.
Appsmith self-hosted is cheaper *per seat at scale* (~$42–80/month total, unlimited
users, once running), but it's not free to start — you're trading a small amount of
recurring infra cost and setup/maintenance effort for something Retool's free tier
already gives you for nothing on day one. Don't pay that cost before you need to.

## Why not stay on Retool forever

Retool's real 2026 pricing beyond the free tier (aggregated from third-party pricing
trackers, not a live vendor quote — reverify at retool.com/pricing before budgeting):
Team plan ~$10/builder + ~$5/end-user beyond the first 5; Business plan ~$50/builder +
$8→$4/external-user tiers. At "10 agencies, ~100 total staff" scale this lands around
US$450–485/month — a real, growing per-seat tax working directly against margin on a
per-unit pricing model. That's the trigger to move to Appsmith: not "Retool is bad,"
but "the free tier's math stops being free."

## Why Appsmith, not straight to custom code, for stage 2

Building the full 14-page spec in Next.js from scratch is realistically 4–8 weeks of
solo/small-team work. Appsmith gets the same page/binding structure you already built
in Retool (translating almost directly — same drag-drop/query paradigm) live again at
near-zero licensing cost, without a multi-week rebuild, while you're still validating
which agencies actually stick around.

## What actually transfers at each migration

- **100% of the backend, every time** — schema, RLS, Edge Functions, Node API. Both
  Retool and Appsmith just need a resource pointed at Supabase + the Node API; Refine.dev
  has a native Supabase data provider that queries the same tables through the same
  RLS policies.
- **0% of the UI, automatically, every time** — no low-code tool exports usable
  production code. Every page gets rebuilt manually at each stage.
- **The specification, which is the part that actually matters** —
  `docs/01-retool-frontend-guide.md`'s page layouts, filter sets, and bindings are the
  migration spec for both moves. You won't be re-deciding what the Tenants page filters
  on at each stage; you'll be re-implementing an already-fully-specified app. Refine.dev's
  own CRUD/filter/auth/Supabase-adapter patterns line up closely with what that spec
  already describes, which is why stage 3 is faster than starting from a blank page.

## The one discipline that makes every migration cheap

Keep business logic **out of** whichever low-code tool's JS queries/transformers.
Every non-trivial action — mark rent paid, renew a lease, resolve an import,
recalculate district scores, send a lease for signature — must call the Node API (as
the current architecture already requires via `genericCrudRouter`, `rentRollService`,
`leaseService`, `importResolverService`, `esignService`). Retool today, and Appsmith
tomorrow, stay thin UI shells calling the same endpoints Refine.dev will call at stage
3. Writing clever logic directly into Retool bindings to save time now means that logic
has to be rediscovered and rewritten at EVERY later migration — it won't be sitting in
a file the next tool can just point at.

## A real structural ceiling worth knowing about

Retool and Appsmith are both built for internal ops tools, not public multi-tenant
SaaS products with paying external customers logging in daily. Two consequences:
- **Licensing tiers for "external" vs. "internal" users differ** and are worth
  reconfirming directly with whichever vendor you're on as your agency count grows —
  don't assume the free-tier or self-hosted math holds forever, that's exactly why
  this is a staged plan with explicit triggers rather than a permanent choice.
- **Polish/performance ceiling**: a competitor with a custom React frontend will
  eventually out-perform and out-polish a Retool- or Appsmith-wrapped product. That's
  the real reason stage 3 exists at all, not just a cost optimization.
