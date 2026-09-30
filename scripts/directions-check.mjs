#!/usr/bin/env node
// Keeps docs/directions honest: every status uses the agreed vocabulary, every
// commit it cites exists, and everything in the completed log is in the bank.
// Usage: node scripts/directions-check.mjs   (exit 1 on any problem)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "docs/directions");
const STATUSES = ["NEW", "PLANNED", "IN PROGRESS", "PARTIAL", "SHIPPED", "VERIFIED", "CODEX", "NEEDS JD", "FUTURE", "ANSWERED"];
const problems = [];

function rows(file) {
  return readFileSync(join(dir, file), "utf8").split("\n")
    .filter((line) => line.startsWith("| ") && !/^\|\s*-{3}/.test(line) && !/^\|\s*(ID|Date|Branch|Update)\s*\|/.test(line))
    .map((line) => line.slice(1, -1).split(" | ").map((cell) => cell.trim()));
}

const commitOk = new Map();
function commitExists(sha) {
  if (!commitOk.has(sha)) {
    try { execFileSync("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }); commitOk.set(sha, true); }
    catch { commitOk.set(sha, false); }
  }
  return commitOk.get(sha);
}
function checkCommits(file, text) {
  for (const sha of text.match(/\b[0-9a-f]{7,40}\b/g) ?? []) {
    if (!/[a-f]/.test(sha) || !/\d/.test(sha)) continue; // plain words or numbers
    if (!commitExists(sha)) problems.push(`${file}: commit ${sha} not found`);
  }
}
const ids = (cell) => cell.split(/,\s*/).flatMap((part) => {
  const range = part.match(/^(I\d)-(\d+)\.\.I\d-(\d+)$/);
  if (!range) return [part.replace(/\s.*$/, "")];
  const out = [];
  for (let n = Number(range[2]); n <= Number(range[3]); n++) out.push(`${range[1]}-${String(n).padStart(2, "0")}`);
  return out;
});

const indexIds = new Set();
for (const cells of rows("01-ideas/INDEX.md")) {
  const [id, , status = "", where = ""] = cells;
  ids(id).forEach((value) => indexIds.add(value));
  if (!STATUSES.some((word) => status.startsWith(word))) problems.push(`INDEX ${id}: unknown status "${status}"`);
  checkCommits(`INDEX ${id}`, where);
}
for (const file of ["04-COMPLETED.md", "02-progress/1-MAJOR.md", "02-progress/2-UPDATES.md", "02-progress/3-HOTFIXES.md"]) {
  for (const cells of rows(file)) {
    checkCommits(file, cells.at(-1) ?? "");
    if (file === "04-COMPLETED.md") {
      for (const id of ids(cells[0])) if (!indexIds.has(id)) problems.push(`04-COMPLETED: ${id} is not in the index`);
    }
  }
}

if (problems.length) {
  console.error(`directions check: ${problems.length} problem(s)\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`directions check: ${indexIds.size} ideas indexed, ${commitOk.size} commits verified, no problems`);
