// POST /functions/v1/universal-importer-extract
// Body: { import_job_id: string, raw_text?: string, raw_rows?: object[] }
//
// This is STAGE 2 of the Universal Data Importer pipeline (see
// docs/02-universal-data-importer.md for the full 7-step workflow diagram):
//   Stage 1 (Node API `POST /api/import/upload`): file type detection + raw
//            text/row extraction (pdf-parse / xlsx / mammoth / Tesseract OCR),
//            writes a data_import_jobs row, uploads original file to Storage.
//   Stage 2 (THIS FUNCTION): send raw text/rows to Claude, get back a detected
//            data_type + column mapping + normalized preview rows.
//   Stage 3 (Retool "Import Preview" page): user reviews/edits mapping.
//   Stage 4 (Node API `POST /api/import/:id/confirm`): validated insert into
//            the target table.
// Model: Sonnet — messy real-world HK agency spreadsheets/PDFs need real
// reasoning to map inconsistent column headers correctly.
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { getSupabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { callClaude, CLAUDE_MODELS } from "../_shared/claude.ts";
import { captureException } from "../_shared/sentry.ts";

const SYSTEM_PROMPT = `You are the Universal Data Importer engine for Likara AI, a Hong Kong
property management platform. You will be given raw extracted text or rows from an
uploaded file (PDF, Excel, CSV, Word, or OCR'd image/screenshot). The file could contain
ANY of these data types: tenants, leases, maintenance_tickets, owners, buildings, units,
payments. Some files mix languages (English + Chinese) or use HK-specific shorthand.

Your job:
1. DETECT which single data_type the file most likely represents. If a file plausibly
   contains more than one (e.g. a lease also carries tenant + unit info), pick the PRIMARY
   record type being imported (e.g. "leases") and note secondary entities in
   \`related_entities\` so the caller can create them first (e.g. auto-create a building/unit
   referenced by name before inserting the lease).
2. MAP each source column/field to our canonical schema field using this reference:
   - tenants: name_en, name_zh, phone, email, emergency_contact, unit_number (to resolve unit_id)
   - leases: unit_number, tenant_name, rent_amount, due_day, grace_period, start_date, end_date,
     deposit, management_fee_type, management_fee_value, special_clauses_en, special_clauses_zh
   - maintenance_tickets: unit_number, issue_en, issue_zh_cn, issue_zh_hk, priority, status,
     channel, vendor_assigned
   - owners: name_en, name_zh, phone, email, address
   - buildings: name_en, name_zh_cn, name_zh_hk, address, district, sub_district, type
   - units: building_name, unit_number, floor, size_sqft, status
   - payments: unit_number, tenant_name, amount, period_month, due_date, date_paid, status,
     payment_method
   HK-specific normalization rules:
   - Phone numbers: strip spaces/dashes, keep as 8-digit HK local format (drop +852 prefix).
   - "unit" / "flat" / "室" / "單位" all map to unit_number.
   - "rent" / "租金" maps to rent_amount — strip "HK$", "$", commas; return a plain number.
   - "due_day" / "交租日" maps to due_day — return an integer 1-31.
   - "lease_end" / "租約完結" / "退租日" maps to end_date — return ISO date YYYY-MM-DD.
   - Building names in raw data may need fuzzy-matching to an existing building; just return
     the raw building name string as-is in \`building_name\`, the caller resolves/creates it.
3. Produce normalized PREVIEW ROWS (max 50 for preview) with mapped canonical field names.
4. Flag rows with missing required fields in \`validation_warnings\`.

Return STRICT JSON only, no markdown fences:
{
  "detected_data_type": "tenants"|"leases"|"maintenance_tickets"|"owners"|"buildings"|"units"|"payments",
  "confidence": 0.0-1.0,
  "related_entities": ["buildings","units"],
  "column_mapping": {"source_column_name": "canonical_field_name", ...},
  "preview_rows": [{"canonical_field_name": "value", ...}, ...],
  "row_count_detected": <int>,
  "validation_warnings": ["Row 3: missing rent_amount", ...]
}`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const { import_job_id, raw_text, raw_rows } = await req.json();
    if (!import_job_id || (!raw_text && !raw_rows)) {
      return json({ error: "import_job_id and one of raw_text/raw_rows are required" }, 400);
    }

    const supabase = getSupabaseAdmin();

    const { data: job, error: jobErr } = await supabase
      .from("data_import_jobs")
      .select("id, agency_id, file_name, file_type")
      .eq("id", import_job_id)
      .single();
    if (jobErr || !job) return json({ error: "Import job not found" }, 404);

    const inputPayload = raw_rows
      ? { mode: "structured_rows", rows: raw_rows.slice(0, 200) }
      : { mode: "raw_text", text: String(raw_text).slice(0, 40000) };

    const raw = await callClaude({
      model: CLAUDE_MODELS.sonnet,
      system: SYSTEM_PROMPT,
      userMessage: JSON.stringify({ file_name: job.file_name, file_type: job.file_type, ...inputPayload }),
      maxTokens: 4000,
      expectJson: true,
    });

    const mapping = JSON.parse(raw);

    await supabase
      .from("data_import_jobs")
      .update({
        status: "mapped",
        detected_data_type: mapping.detected_data_type,
        raw_extracted_text: raw_text ? String(raw_text).slice(0, 100000) : null,
        ai_mapping_json: mapping,
        row_count: mapping.row_count_detected ?? mapping.preview_rows?.length ?? 0,
      })
      .eq("id", import_job_id);

    // Persist per-row records so the confirm step (Node API) can insert them
    // individually with per-row error tracking.
    const rowsToInsert = (mapping.preview_rows ?? []).map((row: unknown, idx: number) => ({
      import_job_id,
      row_number: idx + 1,
      raw_data: raw_rows ? raw_rows[idx] ?? null : null,
      mapped_data: row,
      status: "pending",
      target_table: mapping.detected_data_type,
    }));
    if (rowsToInsert.length > 0) {
      await supabase.from("data_import_rows").insert(rowsToInsert);
    }

    return json({ import_job_id, ...mapping });
  } catch (err) {
    await captureException(err, { function: "universal-importer-extract" });
    return json({ error: "Internal error mapping import" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
