import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/20261106200000_communications_cron_worker.sql", import.meta.url)),
  "utf8",
);

test("AXOM worker schedule uses an idempotent five-minute cron name", () => {
  assert.match(sql, /cron\.schedule/);
  assert.match(sql, /axom-communications-worker-5m/);
  assert.match(sql, /\*\/5 \* \* \* \*/);
});

test("AXOM worker invokes only the existing communications action via Vault", () => {
  assert.match(sql, /functions\/v1\/communications\?action=worker/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /axom_communications_cron_secret/);
  assert.match(sql, /axom_communications_project_url/);
  assert.match(sql, /length\(credential\.decrypted_secret\) >= 32/);
  assert.match(sql, /if not exists\(select 1 from pg_available_extensions/);
  assert.doesNotMatch(sql, /https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/communications/);
});

test("AXOM migration never embeds a credential or allows a public-scheduler fallback", () => {
  assert.match(sql, /'Authorization', 'Bearer ' \|\| credential\.decrypted_secret/);
  assert.match(sql, /origin\.name = 'axom_communications_project_url'/);
  assert.match(sql, /credential\.name = 'axom_communications_cron_secret'/);
  assert.doesNotMatch(sql, /service_role|RESEND_API_KEY|anon_key|publishable_key/);
});
