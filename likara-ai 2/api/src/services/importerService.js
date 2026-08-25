// Universal Data Importer — extraction stage.
// Detects file type from mimetype/extension and extracts raw text (PDF, DOCX,
// images) or structured rows (CSV, XLSX). The AI mapping stage happens in the
// `universal-importer-extract` Edge Function (kept there so the Claude call +
// prompt is identical whether triggered from Node or directly from Retool).
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { createWorker } from "tesseract.js";
import { fromBuffer } from "pdf2pic";
import { supabaseAdmin } from "../lib/supabaseClient.js";

const EXT_TO_TYPE = {
  pdf: "pdf",
  xlsx: "xlsx",
  xls: "xls",
  csv: "csv",
  docx: "docx",
  doc: "docx",
  jpg: "jpg",
  jpeg: "jpg",
  png: "png",
};

export function detectFileType(originalName, mimetype) {
  const ext = originalName.split(".").pop()?.toLowerCase();
  if (ext && EXT_TO_TYPE[ext]) return EXT_TO_TYPE[ext];
  if (mimetype?.includes("pdf")) return "pdf";
  if (mimetype?.includes("spreadsheet") || mimetype?.includes("excel")) return "xlsx";
  if (mimetype?.includes("csv")) return "csv";
  if (mimetype?.includes("word")) return "docx";
  if (mimetype?.includes("png")) return "png";
  if (mimetype?.includes("jpeg")) return "jpg";
  throw new Error(`Unsupported file type for "${originalName}" (${mimetype})`);
}

/**
 * Extracts either { raw_text } (for PDF/DOCX/images) or { raw_rows } (for
 * CSV/XLSX) from a file buffer, ready to hand to the AI mapping stage.
 */
export async function extractFromFile(buffer, fileType) {
  switch (fileType) {
    case "csv": {
      const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return { raw_rows: XLSX.utils.sheet_to_json(sheet, { defval: null }) };
    }
    case "xlsx":
    case "xls": {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return { raw_rows: XLSX.utils.sheet_to_json(sheet, { defval: null }) };
    }
    case "pdf": {
      const parsed = await pdfParse(buffer);
      const text = parsed.text?.trim() ?? "";
      // A near-empty text extraction usually means a SCANNED (image-only) PDF.
      // Fall back to rasterizing each page and OCR'ing it — covers the common
      // case of a lease that was printed, signed, and scanned back in.
      if (text.length > 40) {
        return { raw_text: text };
      }
      console.warn("PDF has little/no extractable text — falling back to OCR rasterization");
      const ocrText = await ocrScannedPdf(buffer);
      if (ocrText.trim().length < 20) {
        throw new Error(
          "Could not extract any text from this PDF, even via OCR. The scan quality may be too " +
            "low — try re-uploading as individual JPG/PNG pages instead."
        );
      }
      return { raw_text: ocrText };
    }
    case "docx": {
      const { value } = await mammoth.extractRawText({ buffer });
      return { raw_text: value };
    }
    case "jpg":
    case "png": {
      const text = await ocrImageBuffer(buffer);
      return { raw_text: text };
    }
    default:
      throw new Error(`No extractor implemented for file type "${fileType}"`);
  }
}

/**
 * Rasterizes every page of a scanned PDF to a PNG and OCRs each one, joining
 * the results with a page-break marker so Claude's column-mapping prompt can
 * still reason about row boundaries that span a page break.
 *
 * Requires GraphicsMagick + Ghostscript on the host (pdf2pic's rasterization
 * dependencies) — see docs/03-deployment-guide.md for the apt.txt entries.
 * OCR itself no longer needs a host binary; see ocrImageBuffer below.
 */
async function ocrScannedPdf(buffer) {
  const converter = fromBuffer(buffer, {
    density: 150,
    format: "png",
    width: 1650,
    height: 2150,
  });

  // -1 = convert every page. Each result carries a `buffer` when
  // responseType: "buffer" is set, avoiding any temp files for the rasterized image.
  const pages = await converter.bulk(-1, { responseType: "buffer" });

  let fullText = "";
  for (const page of pages) {
    if (!page?.buffer) continue;
    const pageText = await ocrImageBuffer(page.buffer);
    fullText += `${pageText}\n\n--- page break ---\n\n`;
  }
  return fullText.trim();
}

// Lazily-created, reused across calls within this process — tesseract.js
// worker startup (loading the WASM core + language data) is expensive
// enough that creating one per OCR call would be wasteful for the
// multi-page scanned-PDF fallback, which calls this once per page.
let workerPromise = null;
function getOcrWorker() {
  if (!workerPromise) {
    // eng + chi_sim + chi_tra covers English, Simplified, and Traditional
    // Chinese — essential for HK lease documents and WhatsApp screenshots.
    // Language data (~tens of MB) is fetched from tesseract.js's CDN on first
    // use by default; for a host without outbound internet access at
    // runtime, download the .traineddata files ahead of time and point
    // `langPath` at a local directory instead — see tesseract.js docs.
    workerPromise = createWorker(["eng", "chi_sim", "chi_tra"], undefined, {
      langPath: process.env.TESSERACT_LANG_PATH || undefined,
    });
  }
  return workerPromise;
}

/**
 * Runs OCR entirely in-process via WASM — deliberately NOT using
 * `node-tesseract-ocr` (which shells out to a `tesseract` binary and carries
 * an unpatched, "no fix available" critical OS command-injection advisory:
 * https://github.com/advisories/GHSA-8j44-735h-w4w2). tesseract.js never
 * invokes a shell, so that entire vulnerability class doesn't apply here.
 */
async function ocrImageBuffer(buffer) {
  const worker = await getOcrWorker();
  const {
    data: { text },
  } = await worker.recognize(buffer);
  return text;
}

/**
 * Uploads the original file to Supabase Storage and creates the
 * data_import_jobs row. Uses the service-role client because the job must be
 * created before we know which agency-scoped RLS context applies to inserts
 * (the row itself carries agency_id from the authenticated caller).
 */
export async function createImportJob({ agencyId, uploadedBy, fileBuffer, fileName, fileType }) {
  const bucket = process.env.STORAGE_BUCKET_IMPORTS || "import-uploads";
  const storagePath = `${agencyId}/${Date.now()}-${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage.from(bucket).upload(storagePath, fileBuffer, {
    contentType: undefined,
    upsert: false,
  });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: job, error } = await supabaseAdmin
    .from("data_import_jobs")
    .insert({
      agency_id: agencyId,
      uploaded_by: uploadedBy,
      file_name: fileName,
      file_type: fileType,
      storage_path: storagePath,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create import job: ${error.message}`);
  return job;
}
