import { Router } from "express";
import { generateMonthlyPaymentRows, markPaymentPaid } from "../services/rentRollService.js";
import { logAudit } from "../services/auditService.js";
import { genericCrudRouter } from "../lib/genericCrudRouter.js";

const router = Router();

// Standard filterable list — powers the Rent Roll table.
router.use(
  "/",
  genericCrudRouter({
    table: "payments",
    entityLabel: "payment",
    filterableColumns: ["unit_id", "tenant_id", "status", "lease_id"],
    selectClause:
      "*, tenants:tenant_id(name_en, name_zh), units:unit_id(unit_number, building_id, buildings:building_id(name_en, district))",
  })
);

// One-click "Mark as Paid" button on the Rent Roll page.
router.post("/:id/mark-paid", async (req, res) => {
  try {
    const { paymentMethod, datePaid } = req.body ?? {};
    const payment = await markPaymentPaid(req.supabase, req.params.id, { paymentMethod, datePaid });
    await logAudit(req.supabase, {
      agencyId: payment.agency_id,
      userId: req.user.id,
      action: "payment.mark_paid",
      details: {
        en: `Marked payment ${payment.id} as paid (HK$${payment.amount})`,
        zh_cn: `已将付款 ${payment.id} 标记为已付 (HK$${payment.amount})`,
        zh_hk: `已將付款 ${payment.id} 標記為已付 (HK$${payment.amount})`,
      },
    });
    res.json({ data: payment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin utility / cron target: generate this month's rent-roll rows for every
// active lease that doesn't have one yet. Safe to call repeatedly (idempotent).
router.post("/generate-monthly", async (req, res) => {
  try {
    const { agency_id, month } = req.body ?? {};
    if (!agency_id) return res.status(400).json({ error: "agency_id is required" });
    const created = await generateMonthlyPaymentRows(req.supabase, agency_id, month);
    res.json({ created_count: created.length, data: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
