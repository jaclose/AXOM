// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256 } from "../question-content/assets";
import type { PackageManifest, PackageQuestion } from "../question-content/package";
import { resolveLibraryReader } from "./nativeInput";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
const source = new TextEncoder().encode("Synthetic source for parser regression tests, not course material.");
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7WQAAAAASUVORK5CYII=", "base64"));
const manifest: PackageManifest = { schemaVersion: 1, course: { name: "EXAMPLE", term: 1, week: 2 },
  bank: { id: "example-w2", title: "Synthetic example", discipline: "Example" },
  source: { filename: "Example.pdf", sourceWeekDeclared: false, axomAssignedWeek: 2 }, questionsFile: "questions.json", assetsDirectory: "assets" };
function question(id: string, evidence: "printed-key" | "answer-reveal-slide" = "printed-key"): PackageQuestion {
  return { id, source: { filename: "Example.pdf", page: 2, questionNumber: 1 },
    stem: [{ type: "text", text: "Which labelled example is selected?" }], choices: [
      { id: `${id}-A`, label: "A", blocks: [{ type: "text", text: "First example" }] },
      { id: `${id}-B`, label: "B", blocks: [{ type: "text", text: "Second example" }] }],
    correctAnswer: { labels: ["A"], evidence }, assets: [], provenance: { method: "manual-transcription" } };
}
async function fixture(questions: PackageQuestion[] = [question("q1")], prefix = "Outer/bank/") {
  const checksum = await sha256(source);
  for (const q of questions) q.provenance.sourceChecksum = checksum;
  const files = new Map<string, Uint8Array>([[`${prefix}manifest.json`, encode(manifest)],
    [`${prefix}questions.json`, encode({ schemaVersion: 1, bankId: manifest.bank.id, questions })], [`${prefix}source/Example.pdf`, source]]);
  return { files, questions, prefix };
}
async function reader(files: Map<string, Uint8Array>) {
  return resolveLibraryReader([...files].map(([path, bytes]) => ({ path, byteSize: bytes.length })), async path => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`Missing fixture ${path}`);
    return bytes.slice();
  });
}
async function first(files: Map<string, Uint8Array>) {
  const read = await reader(files), catalog = decode(await read("catalog.json"));
  const bank = decode(await read(catalog.sources[0].bankFile));
  return { read, catalog, bank };
}

describe("local native packages without a user-authored catalog", () => {
  it.each([true, false])("normalizes a verified bare source digest with original present: %s", async (includeOriginal) => {
    const { files, questions, prefix } = await fixture();
    const checksum = await sha256(source);
    questions[0].provenance.sourceChecksum = checksum.slice(7);
    files.set(`${prefix}questions.json`, encode({ schemaVersion: 1, bankId: manifest.bank.id, questions }));
    if (!includeOriginal) files.delete(`${prefix}source/Example.pdf`);
    const { bank, catalog } = await first(files);
    expect(bank.pkg.questions[0].provenance.sourceChecksum).toBe(checksum);
    expect(catalog.sources[0].checksum).toBe(checksum.slice(7));
    expect(bank.pkg.questions[0].correctAnswer).toEqual(questions[0].correctAnswer);
  });
  it("ignores macOS packaging metadata when checking for separate exports", async () => {
    const { files } = await fixture();
    files.set("__MACOSX/backup/questions.json", encode([{ id: "metadata" }]));
    expect((await first(files)).catalog.sources[0].ready).toBe(1);
  });
  it("honors nested question paths and a conventional trailing slash on the asset directory", async () => {
    const { files, prefix } = await fixture();
    files.set(`${prefix}data/questions.json`, files.get(`${prefix}questions.json`)!);
    files.delete(`${prefix}questions.json`);
    files.set(`${prefix}manifest.json`, encode({ ...manifest, questionsFile: "data/questions.json", assetsDirectory: "assets/" }));
    expect((await first(files)).catalog.sources[0].ready).toBe(1);
  });
  it("does not silently omit a flat export beside native packages", async () => {
    const { files } = await fixture(); files.set("Other/questions.json", encode([{ id: "unmapped" }]));
    await expect(reader(files)).rejects.toThrow(/separate question exports/);
  });
  it("creates a virtual catalog and preserves source content, identity and filing", async () => {
    const { files } = await fixture(), before = [...files].map(([name, bytes]) => [name, Buffer.from(bytes).toString("base64")]);
    const { catalog, bank, read } = await first(files);
    expect(catalog.format).toBe("axom-private-library");
    expect(catalog.sources).toHaveLength(1);
    expect(catalog.sources[0]).toMatchObject({ ready: 1, review: 0, module: "EXAMPLE" });
    expect(bank.pkg.manifest).toEqual({ ...manifest, schemaVersion: 2 });
    expect(bank.pkg.questions[0].stem).toEqual(question("q1").stem);
    expect(await read(catalog.sources[0].originalFile)).toEqual(source);
    expect([...files].map(([name, bytes]) => [name, Buffer.from(bytes).toString("base64")])).toEqual(before);
    expect([...files.keys()].some(name => name.endsWith("catalog.json"))).toBe(false);
  });
  it("preserves marked-slide evidence and the source review gate", async () => {
    const { files } = await fixture([question("q1", "answer-reveal-slide")]);
    const { catalog, bank } = await first(files);
    expect(catalog.sources[0]).toMatchObject({ ready: 0, review: 1 });
    expect(bank.pkg.questions[0].correctAnswer.evidence).toBe("answer-reveal-slide");
  });
  it("does not manufacture a key for a source conflict", async () => {
    const q = question("q1"); delete q.correctAnswer;
    q.flags = [{ type: "source_inconsistency", message: "Two different answers are printed." }];
    const { files } = await fixture([q]); const { bank, catalog } = await first(files);
    expect(bank.pkg.questions[0].correctAnswer).toBeUndefined();
    expect(bank.pkg.questions[0].flags).toEqual(q.flags);
    expect(catalog.sources[0].review).toBe(1);
  });
  it("retains separate sets and shared question numbering", async () => {
    const a = question("a"), b = question("b"); a.source.set = 1; b.source.set = 2;
    const { files } = await fixture([a, b]); const { bank } = await first(files);
    expect(bank.pkg.questions.map((q: PackageQuestion) => [q.id, q.source.set, q.source.questionNumber])).toEqual([["a", 1, 1], ["b", 2, 1]]);
  });
  it("maps actual images to the installer without flattening their visibility roles", async () => {
    const q = question("q1"); q.assets.push({ id: "answer-image", filename: "answer.png", mimeType: "image/png", role: "answer_reveal", questionId: q.id, checksum: await sha256(png) });
    const { files, prefix } = await fixture([q]); files.set(`${prefix}assets/answer.png`, png);
    const { bank, catalog, read } = await first(files);
    expect(bank.pkg.questions[0].assets[0]).toMatchObject({ role: "answer_reveal", width: 1, height: 1 });
    const assetPath = catalog.sources[0].bankFile.replace(/[^/]+$/, "assets/answer.png");
    expect(await read(assetPath)).toEqual(png);
    expect(bank.pkg.questions[0].stem.some((b: { type: string }) => b.type === "image")).toBe(false);
  });
  it("fails clearly on a missing mapped image", async () => {
    const q = question("q1"); q.assets.push({ id: "image", filename: "missing.png", mimeType: "image/png", role: "stem", questionId: q.id });
    const { files } = await fixture([q]); await expect(reader(files)).rejects.toThrow("missing.png");
  });
  it("rejects a tampered image checksum", async () => {
    const q = question("q1"); q.assets.push({ id: "image", filename: "image.png", mimeType: "image/png", role: "reference", questionId: q.id, checksum: `sha256:${"0".repeat(64)}` });
    const { files, prefix } = await fixture([q]); files.set(`${prefix}assets/image.png`, png);
    await expect(reader(files)).rejects.toThrow("does not match its package");
  });
  it("rejects an original different from the package's provenance", async () => {
    const { files, prefix } = await fixture(); files.set(`${prefix}source/Example.pdf`, new TextEncoder().encode("Changed"));
    await expect(reader(files)).rejects.toThrow("does not match its recorded checksum");
  });
  it("does not invent an original when only a recorded checksum exists", async () => {
    const { files, prefix } = await fixture(); files.delete(`${prefix}source/Example.pdf`);
    const { bank, catalog } = await first(files);
    expect(catalog.sources[0].originalFile).toBeUndefined(); expect(bank.sourceBytes).toBe(0);
    expect(bank.notes.join(" ")).toContain("not included");
  });
  it("rejects a package with neither a source nor source identity", async () => {
    const { files, prefix } = await fixture(); files.delete(`${prefix}source/Example.pdf`);
    const body = decode(files.get(`${prefix}questions.json`)!); delete body.questions[0].provenance.sourceChecksum;
    files.set(`${prefix}questions.json`, encode(body)); await expect(reader(files)).rejects.toThrow("original source file or a source checksum");
  });
  it("derives missing provenance only from included original bytes", async () => {
    const { files, prefix } = await fixture();
    const body = decode(files.get(`${prefix}questions.json`)!); delete body.questions[0].provenance.sourceChecksum;
    files.set(`${prefix}questions.json`, encode(body)); const { bank } = await first(files);
    expect(bank.pkg.questions[0].provenance.sourceChecksum).toBe(await sha256(source));
  });
  it("deduplicates exact copies and does not silently pick conflicting source versions", async () => {
    const { files } = await fixture();
    for (const [name, bytes] of [...files]) files.set(name.replace("Outer/bank/", "Outer/copy/"), bytes);
    expect((await first(files)).catalog.sources).toHaveLength(1);
    const body = decode(files.get("Outer/copy/questions.json")!); body.questions[0].correctAnswer.labels = ["B"];
    files.set("Outer/copy/questions.json", encode(body));
    await expect(reader(files)).rejects.toThrow("different packages describe the same source");
  });
  it("preserves an existing wrapped catalog instead of generating a competing one", async () => {
    const original = encode({ format: "axom-private-library", schemaVersion: 1, id: "existing", version: "v1", templates: [], sources: [] });
    const read = await reader(new Map([["Wrapper/catalog.json", original]]));
    expect(await read("catalog.json")).toEqual(original);
    await expect(read("../other")).rejects.toThrow("unsafe");
  });
  it("rejects mismatched bank IDs and unsafe internal asset paths", async () => {
    const { files, prefix } = await fixture();
    const body = decode(files.get(`${prefix}questions.json`)!); body.bankId = "different";
    files.set(`${prefix}questions.json`, encode(body)); await expect(reader(files)).rejects.toThrow("do not belong");
    body.bankId = manifest.bank.id; files.set(`${prefix}questions.json`, encode(body));
    files.set(`${prefix}manifest.json`, encode({ ...manifest, questionsFile: "../questions.json" }));
    await expect(reader(files)).rejects.toThrow("unsafe");
  });
});
