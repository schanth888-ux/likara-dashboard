import { Router } from "express";
import multer from "multer";
import { detectFileType, extractFromFile, createImportJob } from "../services/importerService.js";
import { confirmImportJob } from "../services/importResolverService.js";
import { callEdgeFunction } from "../lib/edgeFunctionClient.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = Router();

// STAGE 1 + 2: upload a file of ANY supported type, extract raw content, and
// get back the AI-detected data type + column mapping + preview rows.
// multipart/form-data: { file: <binary>, agency_id: <uuid> }
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file is required (multipart/form-data field 'file')" });
    const agencyId = req.body.agency_id;
    if (!agencyId) return res.status(400).json({ error: "agency_id is required" });

    const fileType = detectFileType(req.file.originalname, req.file.mimetype);
    const job = await createImportJob({
      agencyId,
      uploadedBy: req.user.id,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
      fileType,
    });

    const extracted = await extractFromFile(req.file.buffer, fileType);

    const mapping = await callEdgeFunction("universal-importer-extract", req.accessToken, {
      import_job_id: job.id,
      ...extracted,
    });

    res.status(201).json({ import_job: job, ...mapping });
  } catch (err) {
    console.error("Import upload failed:", err);
    res.status(400).json({ error: err.message });
  }
});

// STAGE 3: fetch the current preview rows for the review UI (user edits mapping here).
router.get("/:id/rows", async (req, res) => {
  const { data, error } = await req.supabase
    .from("data_import_rows")
    .select("*")
    .eq("import_job_id", req.params.id)
    .order("row_number");
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data });
});

// User edits/corrects a single row's mapping before confirming.
router.patch("/:id/rows/:rowId", async (req, res) => {
  const { data, error } = await req.supabase
    .from("data_import_rows")
    .update({ mapped_data: req.body.mapped_data, status: req.body.status ?? "confirmed" })
    .eq("id", req.params.rowId)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data });
});

// Bulk-confirm all pending rows at once (user reviewed the whole preview and clicked "Confirm Import").
router.post("/:id/confirm-all", async (req, res) => {
  const { error } = await req.supabase
    .from("data_import_rows")
    .update({ status: "confirmed" })
    .eq("import_job_id", req.params.id)
    .eq("status", "pending");
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// STAGE 4: insert every confirmed row into its real target table.
router.post("/:id/confirm", async (req, res) => {
  try {
    const { agency_id } = req.body ?? {};
    if (!agency_id) return res.status(400).json({ error: "agency_id is required" });
    const results = await confirmImportJob(req.supabase, {
      importJobId: req.params.id,
      agencyId: agency_id,
      userId: req.user.id,
    });
    res.json({ data: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  const { data, error } = await req.supabase
    .from("data_import_jobs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data });
});

export default router;
