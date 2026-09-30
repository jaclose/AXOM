/** Shared table-based email layout. Content is escaped at this boundary. */
export interface AxomEmail {
  subject: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  code?: string;
  action?: { label: string; url: string };
  notice: string;
}

export function escapeEmailText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function renderAxomEmail(email: AxomEmail): { subject: string; html: string; text: string } {
  const e = escapeEmailText;
  const url = email.action?.url;
  const safeUrl = url === "{{ .ConfirmationURL }}" || (url && /^https:\/\//i.test(url) && !/[\u0000-\u0020]/.test(url)) ? url : undefined;
  const paragraphs = email.paragraphs.map((line) => `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;color:#35322c;white-space:pre-line">${e(line)}</p>`).join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(email.subject)}</title></head>
<body style="margin:0;padding:0;background:#eeeae3;color:#28251f;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(email.title)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eeeae3"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#faf8f3;border:1px solid #d6d0c5">
<tr><td style="background:#141416;padding:28px 30px;border-bottom:2px solid #c8a96a;color:#e6e2d6;font-family:Georgia,serif;font-size:25px;letter-spacing:5px">AXOM</td></tr>
<tr><td style="padding:32px 30px"><p style="margin:0 0 12px;color:#726042;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">${e(email.eyebrow)}</p>
<h1 style="margin:0 0 22px;font-family:Georgia,serif;font-size:29px;line-height:1.2;font-weight:normal;color:#24221e">${e(email.title)}</h1>${paragraphs}
${email.code ? `<p style="margin:24px 0;padding:20px 12px;border:1px solid #d6d0c5;background:#f0ece4;text-align:center;font-family:Consolas,monospace;font-size:28px;font-weight:bold;letter-spacing:4px;color:#24221e">${e(email.code)}</p><p style="font-size:13px;line-height:1.5;color:#5d574d">Keep this code private. AXOM will never ask you to share it.</p>` : ""}
${safeUrl && email.action ? `<p style="margin:26px 0"><a href="${e(safeUrl)}" style="display:inline-block;background:#24221e;color:#f7f1e6;text-decoration:none;padding:15px 22px;font-size:14px;font-weight:bold">${e(email.action.label)}</a></p>` : ""}
<p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #ded8cd;font-size:13px;line-height:1.6;color:#5d574d">${e(email.notice)}</p></td></tr></table>
</td></tr></table></body></html>`;
  const text = [email.title, "", ...email.paragraphs.flatMap((line) => [line, ""]), ...(email.code ? [`Code: ${email.code}`, "Keep this code private.", ""] : []), ...(safeUrl && email.action ? [`${email.action.label}: ${safeUrl}`, ""] : []), email.notice].join("\n");
  return { subject: email.subject.replace(/[\r\n]/g, " "), html, text };
}

export const AUTH_EMAILS: Record<string, AxomEmail> = {
  confirmation: { subject: "Confirm your AXOM account", eyebrow: "Account verification", title: "Make this workspace yours.", paragraphs: ["Enter this code in AXOM to confirm your email. It works in the browser and the desktop app."], code: "{{ .Token }}", action: { label: "Confirm in your browser", url: "{{ .ConfirmationURL }}" }, notice: "If you did not create an AXOM account, you can ignore this email. No action is needed." },
  magic_link: { subject: "Your AXOM sign-in code", eyebrow: "Secure sign-in", title: "Back to your work.", paragraphs: ["Enter this one-time code in AXOM to sign in. Use the code if you are signing in through the desktop app."], code: "{{ .Token }}", action: { label: "Sign in through your browser", url: "{{ .ConfirmationURL }}" }, notice: "If you did not request this sign-in, do not share the code or follow the link. You can ignore this email." },
  recovery: { subject: "Reset your AXOM password", eyebrow: "Account security", title: "Choose a new password.", paragraphs: ["Enter this code in AXOM to reset your password, or continue in your browser using the link below."], code: "{{ .Token }}", action: { label: "Reset password in your browser", url: "{{ .ConfirmationURL }}" }, notice: "If you did not request a reset, ignore this email. Your password has not changed." },
};

export function renderFeedbackEmail(input: { type: string; area: string; message: string; email: string; version: string; ua: string; receivedAt: string }) {
  return renderAxomEmail({ subject: `AXOM feedback — ${input.type} — ${input.area}`, eyebrow: `${input.type} / ${input.area}`, title: "Feedback from the workspace.", paragraphs: [input.message, `App: ${input.version}\nContact: ${input.email || "Not provided"}\nBrowser: ${input.ua}\nReceived: ${input.receivedAt}`], notice: "Submitted through AXOM. Treat user-provided content and links as untrusted." });
}
