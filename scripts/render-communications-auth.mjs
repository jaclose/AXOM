// Run build-communications.mjs first. This generates files; it never sends mail.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { renderAxomEmail } from "../supabase/functions/communications/service.js";
const folder = new URL("../supabase/templates/communications/", import.meta.url);
await mkdir(folder, { recursive: true });
const base = "https://axom.info";
const context = { displayName: "", accent: "#c8a96a", theme: "dark", locale: "en", timezone: "UTC", orbUrl: base + "/icons/axom-orb-512.png" };
const kinds = { confirmation: "Confirm your AXOM account.", magic_link: "Your AXOM sign-in code.", recovery: "Reset your AXOM password.", invite: "Your invitation to AXOM.", email_change: "Confirm your email change.", reauthentication: "Confirm it is you." };
for (const [name, title] of Object.entries(kinds)) {
  const email = renderAxomEmail({ type: "auth", context, baseUrl: base, actionUrl: "https://axom.invalid/secure-link" });
  const otp = '<p style="font:12px Arial,sans-serif;color:#b2afa8">Your one-time code</p><p style="font:32px monospace;letter-spacing:8px;color:#e6e2d6">{{ .Token }}</p>';
  const slot = '<div id="axom-auth-code"></div>';
  assert.ok(email.html.includes(slot), "Auth renderer must expose its named code slot.");
  let html = email.html.replaceAll("Your secure way in.", title).replace('Use this secure link to continue to your account.', 'Enter the code in AXOM, or use the secure link to continue.').replace(slot, otp).replaceAll("https://axom.invalid/secure-link", "{{ .ConfirmationURL }}");
  if (name === "reauthentication") html = html.replace(/<table class="email-cta"[\s\S]*?<\/table>/, "").replaceAll("Enter the code in AXOM, or use the secure link to continue.", "Enter this one-time code in AXOM to confirm it is you.");
  assert.ok(html.includes("{{ .Token }}"), `${name} must retain the OTP.`);
  assert.equal(html.includes("{{ .ConfirmationURL }}"), name !== "reauthentication");
  await writeFile(new URL(name + ".html", folder), html);
}
await writeFile(new URL("security.html", folder), renderAxomEmail({ type: "security", context, baseUrl: base }).html);
const manifestUrl = new URL("../supabase/functions/communications/source-manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
manifest.authTemplates = Object.fromEntries(await Promise.all([...Object.keys(kinds), "security"].map(async name => ["supabase/templates/communications/" + name + ".html", createHash("sha256").update(await readFile(new URL(name + ".html", folder))).digest("hex")])));
await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + "\n");
console.log("Six auth templates and the security template generated. OTP and secure link variables preserved.");
