import { Router } from "express";
import { logAudit } from "../services/auditService.js";
import { arrayToCsv } from "./csvExport.js";
import { validateBody } from "./validate.js";

/**
 * Factory for a standard filterable-list + CRUD router over an RLS-scoped
 * table. Postgres RLS is the real security boundary; this layer adds
 * pagination, "filter everything" query-param support, soft delete, audit
 * logging, and an audited CSV export on top of it — per the "If it is a
 * column, it should be a filter" UX rule that governs every list page in the
 * product.
 *
 * @param {object} opts
 * @param {string} opts.table - table name
 * @param {string} opts.entityLabel - for audit log messages, e.g. "tenant"
 * @param {string[]} [opts.filterableColumns] - exact-match filters (?building_id=..)
 * @param {string[]} [opts.searchableColumns] - ILIKE search filters (?search=..)
 * @param {string} [opts.selectClause] - override the default `select('*')`
 * @param {import('zod').ZodSchema} [opts.createSchema] - validates POST bodies;
 *   omit to skip validation (existing routes without one keep working exactly
 *   as before — this is opt-in, not a breaking change)
 * @param {import('zod').ZodSchema} [opts.updateSchema] - validates PATCH bodies,
 *   should generally be createSchema.partial()
 */
export function genericCrudRouter({
  table,
  entityLabel,
  filterableColumns = [],
  searchableColumns = [],
  selectClause = "*",
  createSchema,
  updateSchema,
}) {
  const router = Router();

  /** Shared by /  and /export so filtering behavior never drifts between the two. */
  function applyFilters(query, req) {
    for (const col of filterableColumns) {
      const val = req.query[col];
      if (val === undefined) continue;
      if (Array.isArray(val) || val.includes(",")) {
        const values = Array.isArray(val) ? val : val.split(",");
        query = query.in(col, values);
      } else {
        query = query.eq(col, val);
      }
    }
    if (req.query.start_date) query = query.gte("created_at", req.query.start_date);
    if (req.query.end_date) query = query.lte("created_at", req.query.end_date);
    if (req.query.search && searchableColumns.length > 0) {
      const term = `%${req.query.search}%`;
      const orClause = searchableColumns.map((c) => `${c}.ilike.${term}`).join(",");
      query = query.or(orClause);
    }
    return query;
  }

  /** Resolves the caller's agency_id for audit logging, regardless of table shape. */
  async function currentAgencyId(supabase, userId) {
    const { data } = await supabase
      .from("agency_members")
      .select("agency_id")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.agency_id ?? null;
  }

  // LIST — supports every declared filter, a date-range filter (start_date/end_date
  // against `created_at` by default), and `?search=` fuzzy match across searchableColumns.
  router.get("/", async (req, res) => {
    let query = applyFilters(req.supabase.from(table).select(selectClause).is("deleted_at", null), req);

    const page = parseInt(req.query.page ?? "1", 10);
    const pageSize = Math.min(parseInt(req.query.page_size ?? "50", 10), 200);
    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, page, page_size: pageSize });
  });

  // EXPORT — same filters as the list view, uncapped up to 5,000 rows, returned
  // as a CSV download. Every call is written to audit_logs (P2 requirement:
  // "Data Export Log: Tracks who exports data"). Bind Retool's "Export CSV"
  // button to THIS endpoint rather than a table component's built-in export —
  // the built-in export never touches the API and so is invisible to the audit log.
  router.get("/export", async (req, res) => {
    let query = applyFilters(req.supabase.from(table).select(selectClause).is("deleted_at", null), req);
    query = query.limit(5000);

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    const agencyId = await currentAgencyId(req.supabase, req.user.id);
    await logAudit(req.supabase, {
      agencyId,
      userId: req.user.id,
      action: `${entityLabel}.export`,
      details: {
        en: `Exported ${data?.length ?? 0} ${entityLabel} record(s) to CSV`,
        zh_cn: `已导出 ${data?.length ?? 0} 条${entityLabel}记录为CSV`,
        zh_hk: `已匯出 ${data?.length ?? 0} 條${entityLabel}記錄為CSV`,
      },
    });

    const csv = arrayToCsv(data ?? []);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${table}-export-${Date.now()}.csv"`);
    res.send(csv);
  });

  router.get("/:id", async (req, res) => {
    const { data, error } = await req.supabase.from(table).select(selectClause).eq("id", req.params.id).single();
    if (error) return res.status(404).json({ error: "Not found" });
    res.json({ data });
  });

  router.post("/", ...(createSchema ? [validateBody(createSchema)] : []), async (req, res) => {
    const { data, error } = await req.supabase.from(table).insert(req.body).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await logAudit(req.supabase, {
      agencyId: data.agency_id,
      userId: req.user.id,
      action: `${entityLabel}.create`,
      details: {
        en: `Created ${entityLabel} ${data.id}`,
        zh_cn: `已创建${entityLabel} ${data.id}`,
        zh_hk: `已建立${entityLabel} ${data.id}`,
      },
    });
    res.status(201).json({ data });
  });

  router.patch("/:id", ...(updateSchema ? [validateBody(updateSchema)] : []), async (req, res) => {
    const { data, error } = await req.supabase.from(table).update(req.body).eq("id", req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await logAudit(req.supabase, {
      agencyId: data.agency_id,
      userId: req.user.id,
      action: `${entityLabel}.update`,
      details: {
        en: `Updated ${entityLabel} ${data.id}`,
        zh_cn: `已更新${entityLabel} ${data.id}`,
        zh_hk: `已更新${entityLabel} ${data.id}`,
      },
    });
    res.json({ data });
  });

  // Soft delete only — never hard-delete tenant data (audit/PDPO requirements).
  router.delete("/:id", async (req, res) => {
    const { data, error } = await req.supabase
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    await logAudit(req.supabase, {
      agencyId: data.agency_id,
      userId: req.user.id,
      action: `${entityLabel}.delete`,
      details: {
        en: `Soft-deleted ${entityLabel} ${data.id}`,
        zh_cn: `已删除${entityLabel} ${data.id}`,
        zh_hk: `已刪除${entityLabel} ${data.id}`,
      },
    });
    res.status(204).send();
  });

  return router;
}
