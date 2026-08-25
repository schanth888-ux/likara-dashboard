// Stage 4 of the Universal Data Importer: takes user-confirmed mapped rows
// (data_import_rows with status='confirmed') and inserts them into the real
// tables, auto-creating referenced buildings/units by name where needed.
import { logAudit } from "./auditService.js";

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - RLS-scoped client
 */
export async function confirmImportJob(supabase, { importJobId, agencyId, userId }) {
  const { data: job, error: jobError } = await supabase
    .from("data_import_jobs")
    .select("id, detected_data_type")
    .eq("id", importJobId)
    .single();
  if (jobError || !job) throw new Error("Import job not found or not accessible");

  const { data: rows, error: rowsError } = await supabase
    .from("data_import_rows")
    .select("*")
    .eq("import_job_id", importJobId)
    .eq("status", "confirmed");
  if (rowsError) throw new Error(rowsError.message);

  const results = { inserted: 0, failed: 0, errors: [] };

  for (const row of rows) {
    try {
      const targetId = await insertMappedRow(supabase, job.detected_data_type, row.mapped_data, agencyId);
      await supabase
        .from("data_import_rows")
        .update({ status: "inserted", target_id: targetId })
        .eq("id", row.id);
      results.inserted++;
    } catch (err) {
      await supabase
        .from("data_import_rows")
        .update({ status: "error", error_message: err.message })
        .eq("id", row.id);
      results.failed++;
      results.errors.push({ row_number: row.row_number, error: err.message });
    }
  }

  await supabase
    .from("data_import_jobs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", importJobId);

  await logAudit(supabase, {
    agencyId,
    userId,
    action: "import.confirm",
    details: {
      en: `Imported ${results.inserted} ${job.detected_data_type} record(s), ${results.failed} failed.`,
      zh_cn: `已导入 ${results.inserted} 条${job.detected_data_type}记录，${results.failed} 条失败。`,
      zh_hk: `已匯入 ${results.inserted} 條${job.detected_data_type}記錄，${results.failed} 條失敗。`,
    },
  });

  return results;
}

async function insertMappedRow(supabase, dataType, mapped, agencyId) {
  switch (dataType) {
    case "buildings":
      return insertBuilding(supabase, mapped, agencyId);
    case "units":
      return insertUnit(supabase, mapped, agencyId);
    case "owners":
      return insertOwner(supabase, mapped, agencyId);
    case "tenants":
      return insertTenant(supabase, mapped, agencyId);
    case "leases":
      return insertLease(supabase, mapped, agencyId);
    case "maintenance_tickets":
      return insertTicket(supabase, mapped, agencyId);
    case "payments":
      return insertPayment(supabase, mapped, agencyId);
    default:
      throw new Error(`Unsupported import data_type "${dataType}"`);
  }
}

async function resolveBuildingId(supabase, buildingName, agencyId) {
  if (!buildingName) throw new Error("Missing building name to resolve unit against");
  const { data: existing } = await supabase
    .from("buildings")
    .select("id")
    .eq("agency_id", agencyId)
    .ilike("name_en", buildingName)
    .maybeSingle();
  if (existing) return existing.id;

  // Auto-create a minimal building stub; district/sub_district must be filled
  // in later by the user via the Buildings page — flagged in the UI as "Needs district".
  const { data: created, error } = await supabase
    .from("buildings")
    .insert({
      agency_id: agencyId,
      name_en: buildingName,
      address: "TBD — imported record, please complete",
      district: "Kowloon",
      sub_district: "Mong Kok",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not auto-create building "${buildingName}": ${error.message}`);
  return created.id;
}

async function resolveUnitId(supabase, unitNumber, agencyId, buildingName) {
  if (!unitNumber) throw new Error("Missing unit_number");
  const query = supabase.from("units").select("id, building_id").eq("agency_id", agencyId).eq("unit_number", unitNumber);
  const { data: candidates } = await query;
  if (candidates?.length === 1) return candidates[0].id;

  if (buildingName) {
    const buildingId = await resolveBuildingId(supabase, buildingName, agencyId);
    const { data: unit } = await supabase
      .from("units")
      .select("id")
      .eq("building_id", buildingId)
      .eq("unit_number", unitNumber)
      .maybeSingle();
    if (unit) return unit.id;

    const { data: created, error } = await supabase
      .from("units")
      .insert({ agency_id: agencyId, building_id: buildingId, unit_number: unitNumber, status: "vacant" })
      .select("id")
      .single();
    if (error) throw new Error(`Could not auto-create unit "${unitNumber}": ${error.message}`);
    return created.id;
  }

  throw new Error(`Unit "${unitNumber}" not found and no building_name provided to auto-create it`);
}

async function insertBuilding(supabase, m, agencyId) {
  const { data, error } = await supabase
    .from("buildings")
    .insert({
      agency_id: agencyId,
      name_en: m.name_en,
      name_zh_cn: m.name_zh_cn ?? null,
      name_zh_hk: m.name_zh_hk ?? null,
      address: m.address ?? "TBD",
      district: m.district ?? "Kowloon",
      sub_district: m.sub_district ?? "Mong Kok",
      type: m.type ?? "residential",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function insertUnit(supabase, m, agencyId) {
  const buildingId = await resolveBuildingId(supabase, m.building_name, agencyId);
  const { data, error } = await supabase
    .from("units")
    .insert({
      agency_id: agencyId,
      building_id: buildingId,
      unit_number: m.unit_number,
      floor: m.floor ?? null,
      size_sqft: m.size_sqft ?? null,
      status: m.status ?? "vacant",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function insertOwner(supabase, m, agencyId) {
  const { data, error } = await supabase
    .from("owners")
    .insert({
      agency_id: agencyId,
      name_en: m.name_en,
      name_zh: m.name_zh ?? null,
      phone: normalizeHkPhone(m.phone),
      email: m.email ?? null,
      address: m.address ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function insertTenant(supabase, m, agencyId) {
  const unitId = await resolveUnitId(supabase, m.unit_number, agencyId, m.building_name);
  const { data, error } = await supabase
    .from("tenants")
    .insert({
      agency_id: agencyId,
      unit_id: unitId,
      name_en: m.name_en,
      name_zh: m.name_zh ?? null,
      phone: normalizeHkPhone(m.phone),
      email: m.email ?? null,
      emergency_contact: m.emergency_contact ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function insertLease(supabase, m, agencyId) {
  const unitId = await resolveUnitId(supabase, m.unit_number, agencyId, m.building_name);
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id")
    .eq("unit_id", unitId)
    .ilike("name_en", m.tenant_name ?? "")
    .maybeSingle();
  if (tenantErr || !tenant) {
    throw new Error(`Could not resolve tenant "${m.tenant_name}" for unit "${m.unit_number}" — import the tenant first`);
  }
  const { data, error } = await supabase
    .from("leases")
    .insert({
      agency_id: agencyId,
      unit_id: unitId,
      tenant_id: tenant.id,
      rent_amount: parseAmount(m.rent_amount),
      due_day: parseInt(m.due_day, 10) || 1,
      grace_period: parseInt(m.grace_period, 10) || 3,
      start_date: m.start_date,
      end_date: m.end_date,
      deposit: parseAmount(m.deposit) || 0,
      management_fee_type: m.management_fee_type ?? null,
      management_fee_value: m.management_fee_value ?? null,
      special_clauses_en: m.special_clauses_en ?? null,
      special_clauses_zh: m.special_clauses_zh ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function insertTicket(supabase, m, agencyId) {
  const unitId = await resolveUnitId(supabase, m.unit_number, agencyId, m.building_name);
  const { data, error } = await supabase
    .from("maintenance_tickets")
    .insert({
      agency_id: agencyId,
      unit_id: unitId,
      issue_en: m.issue_en ?? null,
      issue_zh_cn: m.issue_zh_cn ?? null,
      issue_zh_hk: m.issue_zh_hk ?? null,
      priority: m.priority ?? "medium",
      status: m.status ?? "open",
      channel: m.channel ?? "other",
      vendor_assigned: m.vendor_assigned ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function insertPayment(supabase, m, agencyId) {
  const unitId = await resolveUnitId(supabase, m.unit_number, agencyId, m.building_name);
  const { data: tenant } = await supabase.from("tenants").select("id").eq("unit_id", unitId).maybeSingle();
  const { data, error } = await supabase
    .from("payments")
    .insert({
      agency_id: agencyId,
      unit_id: unitId,
      tenant_id: tenant?.id,
      amount: parseAmount(m.amount),
      period_month: m.period_month,
      due_date: m.due_date,
      date_paid: m.date_paid ?? null,
      status: m.status ?? "upcoming",
      payment_method: m.payment_method ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// Exported for unit testing (api/tests/importResolverService.test.js).
export function normalizeHkPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  return digits.startsWith("852") ? digits.slice(3) : digits;
}

export function parseAmount(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^\d.-]/g, "");
  // A value with no digits at all (e.g. "N/A", "TBC") must not silently
  // become 0 — Number("") === 0, which would import a lease as free rent
  // with nobody noticing. Only a string that actually contained a digit
  // should ever resolve to a number.
  if (cleaned === "" || !/\d/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}
