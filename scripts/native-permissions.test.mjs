import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../src-tauri/", import.meta.url);

test("registered native commands retain explicit main-window permissions", () => {
  const source = readFileSync(new URL("src/lib.rs", root), "utf8");
  const handler = source.match(/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]/)?.[1];
  assert.ok(handler, "Find the native command registry before auditing permissions");
  const registered = handler.split(",").map((entry) => entry.trim().split("::").at(-1)).filter(Boolean);
  const capability = JSON.parse(readFileSync(new URL("capabilities/default.json", root), "utf8"));
  assert.deepEqual(capability.windows, ["main"]);
  assert.equal(capability.remote, undefined, "Native app commands must not be exposed to remote content");
  const allowed = new Set();
  const permissions = new URL("permissions/", root);
  for (const name of readdirSync(permissions, { recursive: true })) {
    if (!name.endsWith(".toml")) continue;
    const content = readFileSync(`${fileURLToPath(permissions)}${name}`, "utf8");
    for (const block of content.split("[[permission]]").slice(1)) {
      const id = block.match(/identifier\s*=\s*"([^"]+)"/)?.[1];
      if (!capability.permissions.includes(id)) continue;
      const commands = block.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
      for (const match of commands.matchAll(/"([^"]+)"/g)) allowed.add(match[1]);
    }
  }
  assert.deepEqual(registered.filter((command) => !allowed.has(command)), [], "An app ACL also governs old commands; keep their permissions when adding a new capability");
});
