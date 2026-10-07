import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AUTH_EMAILS, renderAxomEmail, renderFeedbackEmail } from "../lib/api/emailTemplates.ts";

test("auth templates and plain text match the shared renderer", async () => {
  for (const [name, definition] of Object.entries(AUTH_EMAILS)) {
    const email = renderAxomEmail(definition);
    assert.match(email.html, /\{\{ \.Token \}\}/);
    assert.match(email.html, /\{\{ \.ConfirmationURL \}\}/);
    for (const [extension, content] of [["html", email.html], ["txt", email.text]]) {
      assert.equal(await readFile(new URL(`../supabase/templates/${name}.${extension}`, import.meta.url), "utf8"), content + "\n");
    }
  }
});
test("feedback escapes untrusted content and sanitizes subject newlines", () => {
  const email = renderFeedbackEmail({ type: "Bug\r\nBcc: victim", area: "<svg onload=alert(1)>", message: '<img src=x onerror="alert(1)">', email: "", version: "QA", ua: "QA", receivedAt: "2026-09-29" });
  assert.doesNotMatch(email.html, /<img|<svg/);
  assert.match(email.html, /&lt;img/);
  assert.doesNotMatch(email.subject, /[\r\n]/);
  assert.match(email.text, /<img src=x/);
});
test("email actions reject non-HTTPS links", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "https://safe.test/\nunsafe"]) {
    const email = renderAxomEmail({ ...AUTH_EMAILS.confirmation, action: { label: "Open", url } });
    assert.doesNotMatch(email.html, /href=/);
  }
});
