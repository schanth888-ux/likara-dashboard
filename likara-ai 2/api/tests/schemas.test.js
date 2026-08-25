import { describe, it, expect } from "vitest";
import {
  ownerCreateSchema,
  buildingCreateSchema,
  tenantCreateSchema,
  maintenanceTicketCreateSchema,
  expenseCreateSchema,
} from "../src/lib/schemas.js";

const AGENCY_ID = "11111111-1111-1111-1111-111111111111";
const UNIT_ID = "22222222-2222-2222-2222-222222222222";

describe("ownerCreateSchema", () => {
  it("accepts a minimal valid owner", () => {
    const result = ownerCreateSchema.safeParse({ agency_id: AGENCY_ID, name_en: "Chan Tai Man" });
    expect(result.success).toBe(true);
  });

  it("rejects a missing name_en", () => {
    const result = ownerCreateSchema.safeParse({ agency_id: AGENCY_ID });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = ownerCreateSchema.safeParse({ agency_id: AGENCY_ID, name_en: "X", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects a phone number with a +852 prefix (must already be normalized to 8 digits)", () => {
    const result = ownerCreateSchema.safeParse({ agency_id: AGENCY_ID, name_en: "X", phone: "+85291234567" });
    expect(result.success).toBe(false);
  });

  it("accepts a plain 8-digit phone number", () => {
    const result = ownerCreateSchema.safeParse({ agency_id: AGENCY_ID, name_en: "X", phone: "91234567" });
    expect(result.success).toBe(true);
  });
});

describe("buildingCreateSchema", () => {
  it("rejects a district not in the fixed HK district list", () => {
    const result = buildingCreateSchema.safeParse({
      agency_id: AGENCY_ID,
      name_en: "Test Building",
      address: "1 Test St",
      district: "Kowloon Bay", // not one of the 5 valid top-level districts
      sub_district: "Kowloon Bay",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid district", () => {
    const result = buildingCreateSchema.safeParse({
      agency_id: AGENCY_ID,
      name_en: "Test Building",
      address: "1 Test St",
      district: "Kowloon",
      sub_district: "Mong Kok",
    });
    expect(result.success).toBe(true);
  });
});

describe("tenantCreateSchema", () => {
  it("requires unit_id to be a real UUID, not an arbitrary string", () => {
    const result = tenantCreateSchema.safeParse({
      agency_id: AGENCY_ID,
      unit_id: "not-a-uuid",
      name_en: "Wong Siu Ming",
    });
    expect(result.success).toBe(false);
  });
});

describe("maintenanceTicketCreateSchema", () => {
  it("rejects a ticket with no issue description in any language", () => {
    const result = maintenanceTicketCreateSchema.safeParse({ agency_id: AGENCY_ID, unit_id: UNIT_ID });
    expect(result.success).toBe(false);
  });

  it("accepts a ticket with only a Cantonese description", () => {
    const result = maintenanceTicketCreateSchema.safeParse({
      agency_id: AGENCY_ID,
      unit_id: UNIT_ID,
      issue_zh_hk: "廚房水喉爆裂",
    });
    expect(result.success).toBe(true);
  });
});

describe("expenseCreateSchema", () => {
  it("rejects an invalid cost_type", () => {
    const result = expenseCreateSchema.safeParse({
      agency_id: AGENCY_ID,
      cost_type: "tenant", // only 'owner' | 'agency' are valid
      category: "Repairs",
      type: "variable",
      amount: 500,
      date_incurred: "2026-08-14",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    const result = expenseCreateSchema.safeParse({
      agency_id: AGENCY_ID,
      cost_type: "owner",
      category: "Repairs",
      type: "variable",
      amount: -50,
      date_incurred: "2026-08-14",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid fixed agency expense", () => {
    const result = expenseCreateSchema.safeParse({
      agency_id: AGENCY_ID,
      cost_type: "agency",
      category: "Software",
      type: "fixed",
      amount: 1200,
      date_incurred: "2026-08-01",
      recurring_monthly: true,
    });
    expect(result.success).toBe(true);
  });
});
