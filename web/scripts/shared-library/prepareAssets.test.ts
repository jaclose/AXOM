// @vitest-environment node
import { expect, it } from "vitest";
import { digest, preparePublication } from "./prepare";
import type { PreparedBank } from "../../src/lib/privateLibrary/types";
it("never publishes orphaned image bytes when their bank payload fails", async () => {
  const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  const template = bytes("T5 - GOER - Lectures:\nWeek 2:\nLecture 01 Synthetic [Lecture]\n");
  const image = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const sourceHash = "a".repeat(64);
  const bank: PreparedBank = { pkg: { manifest: { schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 }, bank: { id: "orphan-test", title: "Synthetic bank", discipline: "Test" }, source: { filename: "fixture.txt", sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets" },
    questions: [{ id: "q1", source: { filename: "fixture.txt", questionNumber: 1 }, stem: [{ type: "text", text: "Which test label comes first?" }, { type: "image", assetId: "figure", role: "question" }], choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "A" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "B" }] }], correctAnswer: { labels: ["A"], evidence: "printed-key" }, assets: [{ id: "figure", filename: "figure.png", mimeType: "image/png", questionId: "q1", role: "question", checksum: `sha256:${digest(image)}` }], provenance: { method: "authored", sourceChecksum: `sha256:${sourceHash}` } }] }, issues: [], sourceText: { rawText: "Synthetic only" }, sourceBytes: 14, notes: [] };
  const catalog = { format: "axom-private-library", schemaVersion: 1, id: "test", version: "1", templates: [{ file: "template.txt", name: "template.txt", checksum: digest(template) }], sources: [{ id: "source", name: "fixture.txt", sourcePath: "fixture.txt", checksum: sourceHash, status: "prepared", reason: "Synthetic", ready: 1, review: 0, bankFile: "banks/test/bank.json" }] };
  const input = new Map([["catalog.json", bytes(catalog)], ["template.txt", template], ["banks/test/bank.json", bytes(bank)], ["banks/test/assets/figure.png", image]]);
  const output = new Map<string, Uint8Array>();
  const result = await preparePublication({ read: async path => { const value = input.get(path); if (!value) throw new Error("Missing synthetic source"); return value; }, write: async (path, value) => { if (path === `banks/${sourceHash}/bank.json`) throw new Error("Simulated disk write failure"); output.set(path, value); } },
    { catalogKey: "test", version: "1", title: "Synthetic catalog", audience: "authenticated", rightsReference: "Synthetic test authorization" });
  expect([...output.keys()].some(path => path.includes("/assets/"))).toBe(true);
  expect(result.plan.body.entries).toHaveLength(1);
  expect(result.plan.body.files.every(file => file.path.startsWith("templates/"))).toBe(true);
  expect(result.coverage.find(row => row.source === "fixture.txt")).toMatchObject({ status: "held", reason: "Simulated disk write failure" });
});
