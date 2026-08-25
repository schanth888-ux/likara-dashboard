# Sales Pitch Script — Likara AI

For a discovery call + live demo with a Hong Kong property agency principal or office
manager (typically 30-45 minutes). Structure: **Open → Discover → Demo → Price → Close**.
Written for a 5-building/100-unit-scale agency, the same profile as the MVP.

---

## 1. Open (2 min)

> "Thanks for making time. Before I show you anything, I want to understand how your
> team currently tracks rent, tenants, and maintenance today — spreadsheets, WhatsApp,
> paper files? However it works right now, that's the baseline I want to beat."

Let them talk. Don't pitch yet. You're listening for:
- How many spreadsheets/systems they currently juggle.
- Who currently chases late rent, and how (manually checking bank statements?).
- How maintenance requests come in (WhatsApp is almost always the answer in HK).
- Whether they manage whole buildings, scattered units, or both — this maps directly
  to why Likara AI is unit-first, not building-first.

## 2. Discover — the three questions that write your demo for you

1. **"When a tenant's rent is late, how do you find out?"**
   (Answer is almost always: someone manually checks, days or weeks later.)
   → Bridge to: Late Rent Alerts, computed automatically from each lease's due day
   and grace period, no manual checking.
2. **"If I asked you right now, this second, how many leases expire in the next 30
   days across your whole portfolio — could you tell me?"**
   (Almost never a confident yes.)
   → Bridge to: Lease Expiry Alerts (red/yellow/green), visible the moment you log in.
3. **"How much of your week goes into re-typing the same tenant/lease info into
   different places — WhatsApp, Excel, your bank's app, a paper file?"**
   → Bridge to: Unit-First single source of truth + the Universal Data Importer
   (they don't have to re-type anything they already have — messy Excel, PDFs,
   even a screenshot of a WhatsApp message works).

## 3. Demo (15-20 min) — follow this exact order

1. **Dashboard Home** — show their real district cards (import a sample of their
   actual buildings beforehand if possible; nothing lands like seeing their own
   building names on screen). Point out the color coding — "green districts run
   themselves, red districts need your attention today."
2. **Rent Roll** — filter to "Late" status. "This is rent that's late, right now,
   without anyone having to check a bank statement."
3. **Universal Data Importer** — this is the wow moment. Ask them beforehand to send
   over one real file (an Excel tenant list, a lease PDF, even a screenshot). Upload
   it live. "You don't need to change how you keep records today — you send it to us
   like this, and we do the typing."
4. **Maintenance Tickets + AI Triage** — type a real HK-style issue in Cantonese
   ("冷氣唔凍" / "廚房漏水") and show the AI instantly suggesting priority + vendor type,
   in all three languages. This lands hard because it's visibly built for Hong Kong,
   not translated from a US product.
5. **AI Smart Search** — ask a real question about their own imported data:
   "Which tenants in [their district] are late on rent?" Instant answer, no report
   request, no waiting on staff.
6. **Lease Summarizer** — one click, trilingual one-page summary of a real lease.
   "Anyone on your team — or the owner — can read this in the language they're
   comfortable in, without you writing it by hand."

## 4. Handle the two objections that always come up

**"We already have [Excel / a property management tool]."**
> "Good — that means the data already exists, and the Universal Importer means you
> don't lose any of it or retype it. The question isn't whether your current setup
> has the data, it's whether it tells you *today* who's late on rent and what's
> expiring in the next 30 days without you going and looking for it."

**"Is our data safe?"**
> "Every agency's data is isolated at the database level — Agency A literally cannot
> query Agency B's data, it's not just an app-level filter. Admins require two-factor
> authentication, everything is encrypted in transit and at rest, and we sign a Data
> Processing Agreement before any of your data touches the system, in line with Hong
> Kong's PDPO."

## 5. Price

> "Pricing is per unit, per month, no long-term lock-in. At your scale — [N] units —
> that's [price] a month for the dashboard you just saw."

| Package | Price/unit | This agency's price (N units) |
|---|---|---|
| Dashboard-Only (Phase 1 — what you just saw) | HKD 30 | HKD 30 × N |
| Dashboard + WhatsApp Bot (Phase 2) | HKD 50 | HKD 50 × N |
| Full Package (Phase 3) | HKD 60 | HKD 60 × N |

> "There's a one-time setup fee between HKD 5,000 and 15,000 depending on how much
> data we're bringing over — for a portfolio your size, expect the lower end of that,
> and most of it is us doing the import work, not you."

Always quote **Phase 1 first** and let them ask about the WhatsApp bot — don't
oversell Phase 2 in an initial pitch; it dilutes the "10 hours/week saved, live today"
message with a roadmap item.

## 6. Close

> "The fastest way to know if this is right for you is to see it running on your own
> portfolio, not a demo one. If you send over [tenant list / one building's leases]
> today, we can have it imported and live for you to log into within [3-5 business
> days], no commitment beyond that first look. Does that work?"

If yes → hand off to [`docs/04-onboarding-checklist.md`](./04-onboarding-checklist.md)
Day 0 immediately; momentum from a good demo call fades fast.

If hesitant → "What would you need to see to feel confident this saves your team real
time?" — get the specific blocker, don't re-pitch generically.
