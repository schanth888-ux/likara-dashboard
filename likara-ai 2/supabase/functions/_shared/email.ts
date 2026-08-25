// Outbound email via Resend. Used only for HIGH-severity anomaly alerts —
// late rent >14 days, repeated maintenance ≥5 tickets, occupancy drop >20pp —
// deliberately not every alert, so admins get a real signal, not noise.
// This is intentionally email, not WhatsApp: the product brief for this phase
// is dashboard-only, and email is the lowest-lift way to get an alert in
// front of someone who isn't currently looking at the dashboard.
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — skipping email send:", subject);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("ALERT_EMAIL_FROM") ?? "Likara AI Alerts <alerts@likara.works>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error("Failed to send alert email:", await res.text());
  }
}

/** Trilingual alert email body — shows all three languages stacked, since we
 * don't yet know the recipient admin's preferred language at this stage. */
export function alertEmailHtml(alert: {
  message_en: string;
  message_zh_cn: string;
  message_zh_hk: string;
  severity: string;
  type: string;
}) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#b45309;">Likara AI — ${alert.severity.toUpperCase()} priority alert</h2>
      <p style="font-size:16px;">${alert.message_en}</p>
      <hr style="border:none;border-top:1px solid #eee;" />
      <p style="font-size:14px;color:#555;">${alert.message_zh_cn}</p>
      <p style="font-size:14px;color:#555;">${alert.message_zh_hk}</p>
      <p style="margin-top:24px;"><a href="https://dashboard.likara.works" style="color:#b45309;">Open Dashboard →</a></p>
    </div>`;
}
