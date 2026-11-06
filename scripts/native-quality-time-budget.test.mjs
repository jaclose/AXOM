import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflow = readFileSync(fileURLToPath(new URL("../.github/workflows/quality.yml", import.meta.url)), "utf8");
const marker = "\n  native:\n";
const start = workflow.indexOf(marker);
assert.ok(start >= 0, "Quality must retain its required native job");
const native = workflow.slice(start + marker.length);

test("native Quality gate allows slow Linux dependency downloads AND Rust verification", () => {
  const timeout = Number(/^    timeout-minutes: (\d+)$/m.exec(native)?.[1]);
  assert.ok(timeout >= 75 && timeout <= 120, "30-minute timeout killed the exact-head release native job during apt downloads");
  assert.match(native, /sudo apt-get -o Acquire::Retries=3 update/);
  assert.match(native, /sudo apt-get -o Acquire::Retries=3 install -y --no-install-recommends/);
});

test("native Quality gate retains actual formatting, compilation and library tests", () => {
  assert.match(native, /cargo fmt --manifest-path src-tauri\/Cargo.toml --check/);
  assert.match(native, /cargo check --manifest-path src-tauri\/Cargo.toml --locked/);
  assert.match(native, /cargo test --manifest-path src-tauri\/Cargo.toml --lib --locked/);
  assert.doesNotMatch(native, /continue-on-error:\s*true|if:\s*false/);
});
