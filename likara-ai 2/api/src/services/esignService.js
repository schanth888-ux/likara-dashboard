// DocuSign eSignature integration for the "Renew Lease" flow.
//
// STATUS: this is a SCAFFOLD, not a verified working integration. It follows
// DocuSign's documented JWT Grant auth flow + eSignature REST API v2.1
// envelope-creation shape, but it has not been run against a real DocuSign
// account or sandbox — there was no DocuSign account/credentials available to
// test against while building this. Before relying on it:
//   1. Create a DocuSign developer sandbox account.
//   2. Register an Integration Key, generate an RSA keypair, and grant
//      consent for JWT impersonation (DocuSign's "obtaining consent" flow).
//   3. Set the six DOCUSIGN_* env vars below.
//   4. Send one real test envelope and confirm the webhook/status-check path
//      before wiring this into a production "Renew Lease" button.
//
// This is deliberately isolated in its own service file so it's easy to swap
// for a different e-signature provider (HelloSign/Dropbox Sign, Adobe Sign)
// without touching leaseService.js or the leases route.
import jwt from "jsonwebtoken";

const DOCUSIGN_AUTH_BASE = process.env.DOCUSIGN_AUTH_BASE || "https://account-d.docusign.com"; // account-d = sandbox
const DOCUSIGN_API_BASE = process.env.DOCUSIGN_API_BASE; // e.g. https://demo.docusign.net/restapi

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const requiredEnvVars = [
    "DOCUSIGN_INTEGRATION_KEY",
    "DOCUSIGN_USER_ID",
    "DOCUSIGN_PRIVATE_KEY",
    "DOCUSIGN_ACCOUNT_ID",
    "DOCUSIGN_API_BASE",
  ];
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`DocuSign is not configured — missing env vars: ${missing.join(", ")}`);
  }

  const assertion = jwt.sign(
    {
      iss: process.env.DOCUSIGN_INTEGRATION_KEY,
      sub: process.env.DOCUSIGN_USER_ID,
      aud: new URL(DOCUSIGN_AUTH_BASE).host,
      scope: "signature impersonation",
    },
    process.env.DOCUSIGN_PRIVATE_KEY,
    { algorithm: "RS256", expiresIn: "1h" }
  );

  const res = await fetch(`${DOCUSIGN_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`DocuSign auth failed: ${await res.text()}`);

  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Sends a lease document for signature. Expects the lease PDF already
 * uploaded to Supabase Storage (lease_document_url on the lease row).
 * @param {object} opts
 * @param {string} opts.documentUrl - signed URL to the lease PDF
 * @param {string} opts.documentName
 * @param {{name: string, email: string}} opts.signer - the tenant
 * @param {string} opts.leaseId - for tracking/webhook correlation
 * @returns {Promise<{envelopeId: string, status: string}>}
 */
export async function sendLeaseForSignature({ documentUrl, documentName, signer, leaseId }) {
  const token = await getAccessToken();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

  const pdfRes = await fetch(documentUrl);
  if (!pdfRes.ok) throw new Error("Could not fetch lease document for signing");
  const pdfBase64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");

  const envelope = {
    emailSubject: `Please sign your Likara AI lease renewal — ${documentName}`,
    documents: [
      {
        documentBase64: pdfBase64,
        name: documentName,
        fileExtension: "pdf",
        documentId: "1",
      },
    ],
    recipients: {
      signers: [
        {
          email: signer.email,
          name: signer.name,
          recipientId: "1",
          routingOrder: "1",
          // A real integration should place this at a real page/x/y coordinate
          // on the actual lease template — anchorString positions it next to
          // a literal "Signature:" marker in the document text instead, which
          // is more robust across slightly different lease layouts.
          tabs: {
            signHereTabs: [{ anchorString: "Signature:", anchorUnits: "pixels", anchorXOffset: "20", anchorYOffset: "-10" }],
          },
        },
      ],
    },
    status: "sent",
    customFields: {
      textCustomFields: [{ name: "lease_id", value: leaseId, show: "false" }],
    },
  };

  const res = await fetch(`${DOCUSIGN_API_BASE}/v2.1/accounts/${accountId}/envelopes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) throw new Error(`DocuSign envelope creation failed: ${await res.text()}`);

  const data = await res.json();
  return { envelopeId: data.envelopeId, status: data.status };
}
