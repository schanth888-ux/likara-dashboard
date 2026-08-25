// Lease lifecycle logic shared across Retool and the future WhatsApp bot.

/**
 * "Renew Lease" — closes out the current lease as 'renewed' and creates a new
 * lease row starting the day after the old one ends, carrying forward rent/
 * terms unless overridden.
 */
export async function renewLease(supabase, leaseId, overrides = {}) {
  const { data: oldLease, error } = await supabase.from("leases").select("*").eq("id", leaseId).single();
  if (error || !oldLease) throw new Error("Lease not found or not accessible");

  const newStart = overrides.start_date ?? addDays(oldLease.end_date, 1);
  const newEnd = overrides.end_date ?? addYears(newStart, 1);

  const { data: newLease, error: insertErr } = await supabase
    .from("leases")
    .insert({
      agency_id: oldLease.agency_id,
      tenant_id: oldLease.tenant_id,
      unit_id: oldLease.unit_id,
      rent_amount: overrides.rent_amount ?? oldLease.rent_amount,
      due_day: overrides.due_day ?? oldLease.due_day,
      grace_period: overrides.grace_period ?? oldLease.grace_period,
      start_date: newStart,
      end_date: newEnd,
      deposit: overrides.deposit ?? oldLease.deposit,
      management_fee_type: overrides.management_fee_type ?? oldLease.management_fee_type,
      management_fee_value: overrides.management_fee_value ?? oldLease.management_fee_value,
      management_fee_amount: overrides.management_fee_amount ?? oldLease.management_fee_amount,
      special_clauses_en: overrides.special_clauses_en ?? oldLease.special_clauses_en,
      special_clauses_zh: overrides.special_clauses_zh ?? oldLease.special_clauses_zh,
      status: "active",
    })
    .select()
    .single();
  if (insertErr) throw new Error(insertErr.message);

  const { error: updateErr } = await supabase.from("leases").update({ status: "renewed" }).eq("id", leaseId);
  if (updateErr) throw new Error(updateErr.message);

  return newLease;
}

// Exported for unit testing (api/tests/leaseService.test.js).
export function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addYears(dateStr, years) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}
