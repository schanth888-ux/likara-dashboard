// Request-body validation schemas — one per entity, mirroring the CHECK
// constraints and NOT NULL columns already enforced in supabase/migrations/20260101000001_schema.sql.
// These don't replace the database constraints (Postgres is still the source
// of truth), they exist so a malformed request fails fast with a clear,
// field-level 400 instead of an opaque Postgres constraint-violation message.
//
// NOTE on agency_id: every create schema requires it because the current
// genericCrudRouter passes req.body straight through to Supabase, relying on
// RLS's with_check (agency_id = auth_agency_id()) to reject a mismatched
// value — the client must already know and send its own agency_id. A cleaner
// long-term fix is auto-injecting req.user's agency_id server-side rather
// than trusting the client to send the right one; that's a genuine follow-up
// worth doing, tracked here rather than silently left unmentioned.
import { z } from "zod";

const uuid = z.string().uuid();
const hkPhone = z.string().regex(/^\d{8}$/, "Expected an 8-digit HK phone number (no +852 prefix, no spaces)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

export const districtEnum = z.enum([
  "Hong Kong Island",
  "Kowloon",
  "New Territories",
  "Lantau Island",
  "Outlying Islands",
]);

export const ownerCreateSchema = z.object({
  agency_id: uuid,
  name_en: z.string().min(1, "name_en is required"),
  name_zh: z.string().optional().nullable(),
  phone: hkPhone.optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
});
export const ownerUpdateSchema = ownerCreateSchema.partial();

export const buildingCreateSchema = z.object({
  agency_id: uuid,
  owner_id: uuid.optional().nullable(),
  name_en: z.string().min(1, "name_en is required"),
  name_zh_cn: z.string().optional().nullable(),
  name_zh_hk: z.string().optional().nullable(),
  address: z.string().min(1, "address is required"),
  district: districtEnum,
  sub_district: z.string().min(1, "sub_district is required"),
  type: z.enum(["residential", "commercial", "industrial", "mixed-use"]).optional(),
});
export const buildingUpdateSchema = buildingCreateSchema.partial();

export const unitCreateSchema = z.object({
  agency_id: uuid.optional(), // auto-synced from building_id by a DB trigger, but harmless if the client sends it
  building_id: uuid,
  owner_id: uuid.optional().nullable(),
  unit_number: z.string().min(1, "unit_number is required"),
  floor: z.string().optional().nullable(),
  size_sqft: z.number().positive().optional().nullable(),
  relationship_manager_id: uuid.optional().nullable(),
  status: z.enum(["vacant", "occupied", "maintenance", "unavailable"]).optional(),
});
export const unitUpdateSchema = unitCreateSchema.partial();

export const tenantCreateSchema = z.object({
  agency_id: uuid,
  unit_id: uuid,
  owner_id: uuid.optional().nullable(),
  name_en: z.string().min(1, "name_en is required"),
  name_zh: z.string().optional().nullable(),
  phone: hkPhone.optional().nullable(),
  email: z.string().email().optional().nullable(),
  emergency_contact: z.string().optional().nullable(),
});
export const tenantUpdateSchema = tenantCreateSchema.partial();

export const maintenanceTicketCreateSchema = z
  .object({
    agency_id: uuid,
    unit_id: uuid,
    issue_en: z.string().optional().nullable(),
    issue_zh_cn: z.string().optional().nullable(),
    issue_zh_hk: z.string().optional().nullable(),
    priority: z.enum(["high", "medium", "low"]).optional().nullable(),
    status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(),
    channel: z.enum(["phone", "whatsapp", "email", "walk-in", "portal", "other"]).optional().nullable(),
    vendor_assigned: z.string().optional().nullable(),
    photo_url: z.string().url().optional().nullable(),
  })
  .refine((data) => data.issue_en || data.issue_zh_cn || data.issue_zh_hk, {
    message: "At least one of issue_en, issue_zh_cn, issue_zh_hk is required",
  });
// .partial() would strip the .refine() above — PATCH intentionally allows
// updating just e.g. `status` without re-supplying an issue description.
export const maintenanceTicketUpdateSchema = z.object({
  unit_id: uuid.optional(),
  issue_en: z.string().optional().nullable(),
  issue_zh_cn: z.string().optional().nullable(),
  issue_zh_hk: z.string().optional().nullable(),
  priority: z.enum(["high", "medium", "low"]).optional().nullable(),
  status: z.enum(["open", "in_progress", "completed", "cancelled"]).optional(),
  channel: z.enum(["phone", "whatsapp", "email", "walk-in", "portal", "other"]).optional().nullable(),
  vendor_assigned: z.string().optional().nullable(),
  photo_url: z.string().url().optional().nullable(),
  resolved_at: z.string().datetime().optional().nullable(),
});

export const expenseCreateSchema = z.object({
  agency_id: uuid,
  unit_id: uuid.optional().nullable(),
  building_id: uuid.optional().nullable(),
  owner_id: uuid.optional().nullable(),
  cost_type: z.enum(["owner", "agency"]),
  category: z.string().min(1, "category is required"),
  type: z.enum(["fixed", "variable"]),
  amount: z.number().nonnegative(),
  description: z.string().optional().nullable(),
  date_incurred: isoDate,
  recurring_monthly: z.boolean().optional(),
  vendor: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export const expenseUpdateSchema = expenseCreateSchema.partial();

export const ownerPortalInviteSchema = z.object({
  owner_id: uuid,
  email: z.string().email(),
  agency_id: uuid.optional(), // only used for audit-log attribution
});
