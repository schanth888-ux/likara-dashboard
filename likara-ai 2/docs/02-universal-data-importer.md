# Universal Data Importer — Architecture & Workflow

## Pipeline overview

```
┌──────────────┐   ┌──────────────────────┐   ┌───────────────────────┐   ┌───────────────┐
│ 1. User      │──▶│ 2. Node API          │──▶│ 3. Edge Function        │──▶│ 4. Retool     │
│ uploads file │   │ /api/import/upload   │   │ universal-importer-    │   │ Preview page  │
│ (any type)   │   │ - detect file type   │   │ extract                │   │ - user reviews│
│              │   │ - extract raw text/  │   │ - Claude (Sonnet) maps │   │   & corrects  │
│              │   │   rows               │   │   columns → canonical  │   │   mapping     │
│              │   │ - upload to Storage  │   │   fields, detects type │   │               │
│              │   │ - create import job  │   │ - writes preview rows  │   │               │
└──────────────┘   └──────────────────────┘   └───────────────────────┘   └───────┬───────┘
                                                                                    │
                                                                                    ▼
                                                                    ┌───────────────────────────┐
                                                                    │ 5. Node API                │
                                                                    │ /api/import/:id/confirm   │
                                                                    │ - resolves building/unit/  │
                                                                    │   tenant by name (auto-    │
                                                                    │   create stubs if needed)  │
                                                                    │ - inserts into real tables │
                                                                    │ - per-row error tracking   │
                                                                    └───────────────────────────┘
```

This matches the 7-step workflow in the product spec exactly:
upload → detect → extract → AI map → preview → user confirms/corrects → insert.

## File type → extraction method

| Type | Library | Notes |
|---|---|---|
| CSV | `xlsx` (reads CSV too) | Direct row parsing, no AI needed for structure |
| XLSX / XLS | `xlsx` | First sheet only for MVP; add a sheet picker if clients need multi-sheet |
| PDF (text) | `pdf-parse` | Works for digitally-generated lease PDFs |
| PDF (scanned) | Reject with a clear message today; rasterize + OCR fallback documented below (Phase 1.1) |
| DOCX | `mammoth` | Extracts raw text; tables inside Word docs come through as text, not structured rows |
| JPG / PNG / screenshots | `node-tesseract-ocr` (`eng+chi_sim+chi_tra`) | Needs the `tesseract` binary installed on the host — see deployment guide |

See [`api/src/services/importerService.js`](../api/src/services/importerService.js) for
the implementation.

### Scanned-PDF OCR fallback (Phase 1.1, not in MVP)

`pdf-parse` returns near-empty text for scanned PDFs. To support these:
1. Rasterize each page to PNG with `pdf2pic` or `pdf-to-img`.
2. OCR each page image with the same `node-tesseract-ocr` call used for JPG/PNG.
3. Concatenate page texts with `\n\n--- page break ---\n\n` before sending to Claude.

This is deliberately deferred from the MVP scope to keep the importer's happy path
fast and reliable for the 5-building/100-unit pilot, where leases are typically
digital PDFs or Excel exports, not scans.

## Column mapping — HK-specific rules baked into the prompt

| Source pattern | Canonical field |
|---|---|
| `tenant_name`, `Tenant`, 租客姓名 | `name_en` / `tenant_name` |
| `tenant_name_zh`, 中文姓名 | `name_zh` |
| `unit`, `flat`, `室`, `單位` | `unit_number` |
| `rent`, `租金`, `Rent(HKD)` (strips `HK$`/`$`/commas) | `rent_amount` |
| `due_day`, `交租日` | `due_day` (int 1-31) |
| `lease_end`, `租約完結`, `退租日` | `end_date` (ISO date) |
| `phone`, `電話`, `Tel` (strips `+852`, spaces, dashes) | `phone` (HK 8-digit) |
| `building`, `Bldg`, `大廈` | `building` name → auto-create/map on confirm |

Full prompt: [`prompts/universal-importer-mapping.md`](../prompts/universal-importer-mapping.md).

## Auto-create behavior on confirm

When a mapped row references a building or unit that doesn't exist yet
(`resolveBuildingId` / `resolveUnitId` in
[`importResolverService.js`](../api/src/services/importResolverService.js)):
- A **building** is auto-created with a placeholder `district`/`sub_district`
  (`Kowloon` / `Mong Kok`) and `address = "TBD — imported record, please complete"`.
  The Buildings page should visually flag these (e.g. a badge when `address` starts
  with `"TBD"`) so staff know to complete them.
- A **unit** is auto-created with `status = 'vacant'` under the resolved building.
- **Tenants and leases are never auto-created as a side effect of another import** —
  if a lease row references a tenant name that doesn't already exist as a `tenants`
  row, the row fails with a clear error ("import the tenant first"), because
  fabricating a tenant record from a lease spreadsheet's free-text name is too
  error-prone to do silently.

## Validation & error handling

- `validation_warnings` from Claude are surfaced in the Retool preview as yellow-highlighted
  rows — informational, does not block confirmation.
- Rows that fail at insert time (stage 4) are recorded per-row in `data_import_rows`
  (`status='error'`, `error_message`) — the job as a whole still completes, so one bad
  row never blocks the other 49.
- A full job's outcome is summarized as `{ inserted, failed, errors: [...] }` and shown
  to the user immediately after confirming.

## Extending to a new data type

1. Add the canonical field list to the `universal-importer-extract` system prompt.
2. Add an `insertX()` function to `importResolverService.js`.
3. Add the new `data_type` value to the `data_import_jobs.detected_data_type` CHECK
   constraint in `supabase/migrations/20260101000001_schema.sql`.
