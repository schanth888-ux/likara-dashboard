// Owner Portal routes. Owners authenticate through the SAME Supabase Auth
// flow as agency staff (magic link → session JWT), but are identified by an
// `owner_portal_users` row instead of `agency_members` — requireAuth (already
// applied in index.js) is all the auth these routes need; RLS (see
// supabase/migrations/20260101000004_owner_portal.sql) does the actual data-scoping.
//
// Note the read-only nature of this surface: owners can also call the
// existing /api/buildings, /api/units, /api/tenants, /api/leases,
// /api/payments, /api/maintenance-tickets routes directly (mounted in
// entities.js/leases.js/payments.js) — RLS automatically narrows those to
// their own portfolio. Writes from an owner session fail at the RLS layer
// (no owner-scoped INSERT/UPDATE policy exists), which is intentional.
import { Router } from "express";
import { supabaseAdmin, hkTodayISO } from "../lib/supabaseClient.js";
import { requireAdmin } from "../middleware/auth.js";
import { logAudit } from "../services/auditService.js";
import { validateBody } from "../lib/validate.js";
import { ownerPortalInviteSchema } from "../lib/schemas.js";

const router = Router();

// Admin-only: grant an owner portal access via a Supabase magic-link invite.
router.post("/invite", requireAdmin, validateBody(ownerPortalInviteSchema), async (req, res) => {
  try {
    const { owner_id, email } = req.body;

    // Requires the service-role client — inviting a user is an admin-level
    // Supabase Auth operation, never exposed to the browser directly.
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://dashboard.likara.works/owner-portal/set-password",
    });
    if (inviteErr) return res.status(400).json({ error: inviteErr.message });

    const { error: linkErr } = await req.supabase
      .from("owner_portal_users")
      .insert({ owner_id, user_id: invited.user.id });
    if (linkErr) return res.status(400).json({ error: linkErr.message });

    await logAudit(req.supabase, {
      agencyId: req.body.agency_id ?? null,
      userId: req.user.id,
      action: "owner_portal.invite",
      details: {
        en: `Invited owner portal access for ${email}`,
        zh_cn: `已邀请业主 ${email} 使用业主门户`,
        zh_hk: `已邀請業主 ${email} 使用業主門戶`,
      },
    });

    res.status(201).json({ ok: true, invited_user_id: invited.user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner-facing: a single summary endpoint for their portfolio, instead of
// making them stitch together buildings/units/payments/tickets themselves.
router.get("/my-summary", async (req, res) => {
  const { data: link } = await req.supabase
    .from("owner_portal_users")
    .select("owner_id")
    .eq("user_id", req.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!link) return res.status(403).json({ error: "This account has no owner portal access" });

  const ownerId = link.owner_id;

  const [{ data: buildings }, { data: units }, { data: payments }, { data: tickets }] = await Promise.all([
    req.supabase.from("buildings").select("id, name_en, district, sub_district").eq("owner_id", ownerId),
    req.supabase.from("units").select("id, unit_number, status, building_id").eq("owner_id", ownerId),
    req.supabase
      .from("v_rent_roll")
      .select("status, rent_amount, period_month")
      .eq("owner_id", ownerId)
      .gte("period_month", `${hkTodayISO().slice(0, 7)}-01`),
    req.supabase
      .from("maintenance_tickets")
      .select("id, status, priority")
      .in("unit_id", (units ?? []).map((u) => u.id)),
  ]);

  const occupied = (units ?? []).filter((u) => u.status === "occupied").length;
  const rentCollected = (payments ?? [])
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + Number(p.rent_amount ?? 0), 0);

  res.json({
    data: {
      building_count: buildings?.length ?? 0,
      unit_count: units?.length ?? 0,
      occupied_count: occupied,
      occupancy_pct: units?.length ? Math.round((occupied / units.length) * 100) : 0,
      rent_collected_this_month_hkd: rentCollected,
      open_tickets: (tickets ?? []).filter((t) => t.status === "open" || t.status === "in_progress").length,
      buildings,
    },
  });
});

export default router;
