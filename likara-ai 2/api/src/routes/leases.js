import { Router } from "express";
import { genericCrudRouter } from "../lib/genericCrudRouter.js";
import { renewLease } from "../services/leaseService.js";
import { sendLeaseForSignature } from "../services/esignService.js";
import { logAudit } from "../services/auditService.js";

const router = Router();

router.use(
  "/",
  genericCrudRouter({
    table: "leases",
    entityLabel: "lease",
    filterableColumns: ["unit_id", "tenant_id", "status", "due_day"],
    selectClause:
      "*, tenants:tenant_id(name_en, name_zh), units:unit_id(unit_number, building_id, buildings:building_id(name_en))",
  })
);

// Views the Leases page reads directly for colour-coded expiry (red/yellow/green).
router.get("/status/expiry", async (req, res) => {
  const { data, error } = await req.supabase.from("v_lease_status").select("*");
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data });
});

// "Renew Lease" button.
router.post("/:id/renew", async (req, res) => {
  try {
    const newLease = await renewLease(req.supabase, req.params.id, req.body ?? {});
    await logAudit(req.supabase, {
      agencyId: newLease.agency_id,
      userId: req.user.id,
      action: "lease.renew",
      details: {
        en: `Renewed lease into new lease ${newLease.id}`,
        zh_cn: `续租，新租约 ${newLease.id}`,
        zh_hk: `續租，新租約 ${newLease.id}`,
      },
    });
    res.status(201).json({ data: newLease });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "Send for Signature" — see api/src/services/esignService.js SCAFFOLD note
// at the top of that file before wiring this into a production button; it
// has not been run against a real DocuSign account yet.
router.post("/:id/send-for-signature", async (req, res) => {
  try {
    const { data: lease, error } = await req.supabase
      .from("leases")
      .select("id, lease_document_url, lease_document_name, tenants:tenant_id(name_en, email)")
      .eq("id", req.params.id)
      .single();
    if (error || !lease) return res.status(404).json({ error: "Lease not found or not accessible" });
    if (!lease.lease_document_url) {
      return res.status(400).json({ error: "Upload a lease document before sending it for signature" });
    }
    if (!lease.tenants?.email) {
      return res.status(400).json({ error: "Tenant has no email on file — cannot send for signature" });
    }

    const result = await sendLeaseForSignature({
      documentUrl: lease.lease_document_url,
      documentName: lease.lease_document_name ?? "lease.pdf",
      signer: { name: lease.tenants.name_en, email: lease.tenants.email },
      leaseId: lease.id,
    });

    await logAudit(req.supabase, {
      agencyId: null,
      userId: req.user.id,
      action: "lease.send_for_signature",
      details: {
        en: `Sent lease ${lease.id} for e-signature (envelope ${result.envelopeId})`,
        zh_cn: `已发送租约 ${lease.id} 电子签署 (信封 ${result.envelopeId})`,
        zh_hk: `已發送租約 ${lease.id} 電子簽署 (信封 ${result.envelopeId})`,
      },
    });

    res.json({ data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Lease document upload URL — client PUTs the PDF/Word file directly to this
// signed URL, then PATCHes the lease with lease_document_url/name.
router.post("/:id/document-upload-url", async (req, res) => {
  const { file_name } = req.body ?? {};
  if (!file_name) return res.status(400).json({ error: "file_name is required" });
  const bucket = process.env.STORAGE_BUCKET_LEASES || "lease-documents";
  const path = `${req.params.id}/${Date.now()}-${file_name}`;
  const { data, error } = await req.supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ signed_url: data.signedUrl, path, token: data.token });
});

export default router;
