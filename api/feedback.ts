import { optionalString, requireBodyObject, requireString, sendJson, withApi } from "../lib/api/http.js";

// Alpha feedback intake. Sends an email via Resend when RESEND_API_KEY is set;
// otherwise returns 501 so the client shows the clean "copy + email" fallback.
// No secrets are ever exposed to the client. The resend.dev default sender only
// delivers to the Resend account's own address; set FEEDBACK_FROM to an address
// on a domain verified in Resend (`npm run accounts:doctor` checks it).
const TO = process.env.FEEDBACK_TO || "jdabbagh@sgu.edu";
const FROM = process.env.FEEDBACK_FROM || "AXOM Feedback <onboarding@resend.dev>";

export default withApi(["POST"], async (req, res) => {
  const body = requireBodyObject(req);
  const type = requireString(body, "type", { max: 40 });
  const area = optionalString(body, "area", 80) || "Unspecified";
  const message = requireString(body, "message", { max: 5000 });
  const email = optionalString(body, "email", 200) || "";
  const version = optionalString(body, "version", 120) || "unknown";
  const ua = optionalString(body, "ua", 400) || "";

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Not configured — tell the client to fall back gracefully (not an error).
    sendJson(res, { ok: false, configured: false, message: "Email sending is not configured on this build." }, 501);
    return;
  }

  const text = [
    `Type: ${type}`, `Area: ${area}`, "", message, "",
    `App: ${version}`, `Contact: ${email || "(none)"}`, `Browser: ${ua}`,
    `Received: ${new Date().toISOString()}`,
  ].join("\n");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [TO], reply_to: email || undefined,
      subject: `AXOM Feedback — ${type} — ${area}`, text,
    }),
  });

  if (!r.ok) {
    // Resend explains rejections (unverified domain, restricted key) in the
    // body; log that reason for the Vercel function logs, never the key.
    const reason = await r.json().then((data: { name?: string; message?: string }) => `${data.name ?? ""} ${data.message ?? ""}`.trim(), () => "");
    console.error("resend", r.status, reason.slice(0, 300));
    sendJson(res, { ok: false, configured: true, message: "Could not send right now." }, 502);
    return;
  }
  sendJson(res, { ok: true });
}, { rateLimit: 20 });
