// Rent roll business logic — shared by the Retool "Mark as Paid" button today
// and the Phase-2 WhatsApp bot's "pay rent" flow tomorrow. Keeping this out of
// Retool query bindings means both surfaces get identical due-date/grace-period
// math instead of two implementations drifting apart.
import { hkTodayISO } from "../lib/supabaseClient.js";

/**
 * Generates this month's payment rows for every active lease that doesn't
 * already have one. Idempotent — safe to run daily or on-demand (unique
 * constraint on (lease_id, period_month) prevents duplicates).
 */
export async function generateMonthlyPaymentRows(supabase, agencyId, forMonth = currentHkMonth()) {
  const { data: leases, error } = await supabase
    .from("leases")
    .select("id, agency_id, unit_id, tenant_id, rent_amount, due_day")
    .eq("agency_id", agencyId)
    .eq("status", "active")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const periodMonth = `${forMonth}-01`;
  const created = [];

  for (const lease of leases ?? []) {
    const dueDate = clampDueDate(forMonth, lease.due_day);
    const { data: existing } = await supabase
      .from("payments")
      .select("id")
      .eq("lease_id", lease.id)
      .eq("period_month", periodMonth)
      .maybeSingle();
    if (existing) continue;

    const { data: inserted, error: insertErr } = await supabase
      .from("payments")
      .insert({
        agency_id: agencyId,
        lease_id: lease.id,
        unit_id: lease.unit_id,
        tenant_id: lease.tenant_id,
        amount: lease.rent_amount,
        period_month: periodMonth,
        due_date: dueDate,
        status: "upcoming",
      })
      .select()
      .single();
    if (insertErr) {
      console.error(`Failed to create payment row for lease ${lease.id}:`, insertErr.message);
      continue;
    }
    created.push(inserted);
  }
  return created;
}

/** Marks a payment as paid — the one-click "Mark as Paid" button on Rent Roll. */
export async function markPaymentPaid(supabase, paymentId, { paymentMethod, datePaid } = {}) {
  const { data, error } = await supabase
    .from("payments")
    .update({
      status: "paid",
      date_paid: datePaid ?? hkTodayISO(),
      payment_method: paymentMethod ?? null,
    })
    .eq("id", paymentId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** due_day may exceed the number of days in the month (e.g. 31 in February) — clamp to month end.
 * Exported for unit testing (api/tests/rentRollService.test.js). */
export function clampDueDate(yyyyMm, dueDay) {
  const [year, month] = yyyyMm.split("-").map(Number);
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const day = Math.min(dueDay, lastDayOfMonth);
  return `${yyyyMm}-${String(day).padStart(2, "0")}`;
}

function currentHkMonth() {
  return hkTodayISO().slice(0, 7); // YYYY-MM
}
