import { Router } from "express";
import { genericCrudRouter } from "../lib/genericCrudRouter.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  ownerCreateSchema,
  ownerUpdateSchema,
  buildingCreateSchema,
  buildingUpdateSchema,
  unitCreateSchema,
  unitUpdateSchema,
  tenantCreateSchema,
  tenantUpdateSchema,
  maintenanceTicketCreateSchema,
  maintenanceTicketUpdateSchema,
  expenseCreateSchema,
  expenseUpdateSchema,
} from "../lib/schemas.js";

const router = Router();

router.use(
  "/owners",
  genericCrudRouter({
    table: "owners",
    entityLabel: "owner",
    filterableColumns: ["agency_id"],
    searchableColumns: ["name_en", "name_zh"],
    createSchema: ownerCreateSchema,
    updateSchema: ownerUpdateSchema,
  })
);

router.use(
  "/buildings",
  genericCrudRouter({
    table: "buildings",
    entityLabel: "building",
    filterableColumns: ["owner_id", "district", "sub_district", "type"],
    searchableColumns: ["name_en", "name_zh_cn", "name_zh_hk", "address"],
    createSchema: buildingCreateSchema,
    updateSchema: buildingUpdateSchema,
  })
);

router.use(
  "/units",
  genericCrudRouter({
    table: "units",
    entityLabel: "unit",
    filterableColumns: ["building_id", "owner_id", "status", "relationship_manager_id"],
    searchableColumns: ["unit_number"],
    selectClause: "*, buildings:building_id(name_en, district, sub_district), owners:owner_id(name_en)",
    createSchema: unitCreateSchema,
    updateSchema: unitUpdateSchema,
  })
);

router.use(
  "/tenants",
  genericCrudRouter({
    table: "tenants",
    entityLabel: "tenant",
    filterableColumns: ["unit_id", "owner_id"],
    searchableColumns: ["name_en", "name_zh", "phone", "email"],
    selectClause: "*, units:unit_id(unit_number, building_id, buildings:building_id(name_en))",
    createSchema: tenantCreateSchema,
    updateSchema: tenantUpdateSchema,
  })
);

router.use(
  "/maintenance-tickets",
  genericCrudRouter({
    table: "maintenance_tickets",
    entityLabel: "ticket",
    filterableColumns: ["unit_id", "priority", "status", "channel"],
    searchableColumns: ["issue_en", "issue_zh_cn", "issue_zh_hk", "vendor_assigned"],
    createSchema: maintenanceTicketCreateSchema,
    updateSchema: maintenanceTicketUpdateSchema,
  })
);

// Expenses: admin-only per spec ("Staff cannot see costs") — RLS already
// enforces this at the DB layer; requireAdmin gives a clean 403 instead of an
// empty result set, which is better UX for the Retool "Add Expense" modal.
router.use(
  "/expenses",
  requireAdmin,
  genericCrudRouter({
    table: "expenses",
    entityLabel: "expense",
    filterableColumns: ["cost_type", "category", "type", "unit_id", "building_id", "owner_id"],
    searchableColumns: ["description", "vendor"],
    createSchema: expenseCreateSchema,
    updateSchema: expenseUpdateSchema,
  })
);

router.use(
  "/team",
  requireAdmin,
  genericCrudRouter({
    table: "agency_members",
    entityLabel: "team_member",
    filterableColumns: ["role", "is_active"],
    searchableColumns: ["full_name", "email"],
  })
);

export default router;
