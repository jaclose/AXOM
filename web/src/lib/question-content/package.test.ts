import { describe, expect, it } from "vitest";
import { PACKAGE_SCHEMA_VERSION, questionScope, type ImportPackage, type PackageQuestion } from "./package";
import { parsePackage, serializeManifest, serializeQuestionsFile } from "./packageJson";

const manifest = {
  schemaVersion: 1,
  course: { name: "EXAMPLE", term: 1, week: 3 },
  bank: { id: "example-bank", title: "Example bank", discipline: "Example", topic: "Shapes" },
  source: { filename: "invented.pdf", sourceWeekDeclared: false, axomAssignedWeek: 3 },
  questionsFile: "questions.json",
  assetsDirectory: "assets/",
};

const question = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "ex-q01",
  source: { filename: "invented.pdf", page: 2, questionNumber: 1 },
  stem: [{ type: "text", text: "  Two spaces lead this stem.  It ends with a tab.\t" }],
  choices: [
    { id: "ex-q01-a", label: "A", blocks: [{ type: "text", text: "one" }] },
    { id: "ex-q01-b", label: "B", blocks: [{ type: "text", text: "two" }] },
  ],
  correctAnswer: { labels: ["B"] },
  assets: [],
  provenance: { method: "authored" },
  ...over,
});

const read = (questions: unknown[], manifestOver: Record<string, unknown> = {}) =>
  parsePackage(JSON.stringify({ ...manifest, ...manifestOver }), JSON.stringify({ schemaVersion: 1, bankId: "example-bank", questions }));

describe("reading a package", () => {
  it("keeps the source's wording to the character", () => {
    const parsed = read([question()]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.package!.questions[0].stem).toEqual([{ type: "text", text: "  Two spaces lead this stem.  It ends with a tab.\t" }]);
  });

  it("refuses a package made by a newer AXOM and says why", () => {
    const parsed = read([question()], { schemaVersion: PACKAGE_SCHEMA_VERSION + 1 });
    expect(parsed.package).toBeUndefined();
    expect(parsed.issues).toEqual([expect.objectContaining({ severity: "error", code: "unsupported_version" })]);
  });

  it("refuses a file with no schemaVersion, and a file that is not JSON", () => {
    expect(parsePackage(JSON.stringify({ ...manifest, schemaVersion: undefined }), "{}").issues.map((issue) => issue.code)).toContain("invalid_package");
    expect(parsePackage("{ not json", "[]").package).toBeUndefined();
  });

  it("reports a questions file that belongs to another bank", () => {
    const parsed = parsePackage(JSON.stringify(manifest), JSON.stringify({ schemaVersion: 1, bankId: "another-bank", questions: [question()] }));
    expect(parsed.issues).toEqual([expect.objectContaining({ severity: "error", code: "scope_mismatch" })]);
  });

  it("says so when it leaves a field out, instead of dropping it quietly", () => {
    const parsed = read([question({ imageUrl: "figure.png" })]);
    expect(parsed.issues).toEqual([expect.objectContaining({ severity: "warning", code: "unknown_field", questionId: "ex-q01" })]);
    expect(parsed.package!.questions[0]).not.toHaveProperty("imageUrl");
  });

  it("will not take a number for a table cell, so 0.50 cannot become 0.5", () => {
    const parsed = read([question({ stem: [{ type: "text", text: "Read the table." }, { type: "table", rows: [["Dose", 0.5]] }] })]);
    expect(parsed.issues).toEqual([expect.objectContaining({ severity: "error", code: "invalid_block", questionId: "ex-q01", path: "stem[1]" })]);
  });

  it("warns about a table whose rows are not the same width, and keeps it as written", () => {
    const parsed = read([question({ stem: [{ type: "table", headers: ["a", "b"], rows: [["1", "2"], ["3"]] }] })]);
    expect(parsed.issues).toEqual([expect.objectContaining({ severity: "warning", code: "table_parse_uncertain" })]);
    expect(parsed.package!.questions[0].stem[0]).toMatchObject({ rows: [["1", "2"], ["3"]] });
  });

  it("keeps markup it will not run as text, and reports it", () => {
    const parsed = read([question({ stem: [{ type: "rich_text", html: "x<sup>2</sup><script>steal()</script>" }] })]);
    expect(parsed.issues).toEqual([expect.objectContaining({ code: "rich_text_escaped" })]);
    expect(parsed.package!.questions[0].stem[0]).toEqual({ type: "rich_text", html: "x<sup>2</sup>&lt;script&gt;steal()&lt;/script&gt;" });
  });

  it("does not read a question that does not say how it was made or where it came from", () => {
    expect(read([question({ provenance: undefined })]).package!.questions).toEqual([]);
    expect(read([question({ source: {} })]).issues).toEqual([expect.objectContaining({ code: "invalid_question", path: "source" })]);
  });

  it("requires a shared answer table to name the choice of every row", () => {
    const parsed = read([question({ choiceTable: { type: "table", headers: ["x"], rows: [["↑"], ["↓"]] } })]);
    expect(parsed.issues).toEqual([expect.objectContaining({ severity: "error", code: "invalid_block", path: "choiceTable" })]);
  });
});

describe("writing a package", () => {
  const shuffled = (value: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(value).reverse());

  it("writes the same text whatever order the fields arrived in", () => {
    const tidy = read([question()]).package!;
    const untidy = parsePackage(JSON.stringify(shuffled(manifest)), JSON.stringify({ questions: [shuffled(question())], bankId: "example-bank", schemaVersion: 1 })).package!;
    expect(serializeQuestionsFile(untidy)).toBe(serializeQuestionsFile(tidy));
    expect(serializeManifest(untidy.manifest)).toBe(serializeManifest(tidy.manifest));
  });

  it("gives back an equal package after export and re-import, and the same text after a second export", () => {
    const rich: PackageQuestion = {
      id: "ex-q02",
      week: 4,
      subtopic: "Order",
      source: { filename: "invented.pdf", page: 5, pageEnd: 6, questionNumber: 2, set: 2 },
      stem: [
        { type: "text", text: "Before the table." },
        { type: "table", caption: "Panel", headers: ["", "Seen", "Not seen"], rowHeaders: true, rows: [["Exposed", "12", "0.50"], ["Unexposed", "↑↑", "±"]], sourceImageAssetId: "ex-q02-img-2" },
        { type: "text", text: "Between." },
        { type: "image", assetId: "ex-q02-img-1", alt: "A figure", caption: "Figure 1" },
        { type: "equation", latex: "x^2", plainText: "x squared" },
        { type: "divider" },
        { type: "callout", tone: "warning", text: "Read every row." },
        { type: "text", text: "The prompt." },
      ],
      choices: [
        { id: "ex-q02-a", label: "A", blocks: [] },
        { id: "ex-q02-b", label: "B", blocks: [] },
      ],
      choiceTable: { type: "table", headers: ["β", "μ"], rowKeys: ["A", "B"], rows: [["↑", "↓"], ["↔", "↑"]] },
      correctAnswer: { labels: ["A"], evidence: "answer-reveal-slide" },
      explanation: [{ type: "rich_text", html: "t<sub>½</sub>" }, { type: "image", assetId: "ex-q02-img-3", role: "explanation" }],
      assets: [
        { id: "ex-q02-img-1", filename: "figure.png", mimeType: "image/png", width: 640, height: 480, byteSize: 1234, sourceFile: "invented.pdf", sourcePage: 5, role: "stem", questionId: "ex-q02", checksum: "sha256:00", derivation: "region-render", bounds: { x: 10, y: 20.5, width: 300, height: 200 } },
        { id: "ex-q02-img-2", filename: "table.png", mimeType: "image/png", role: "reference", questionId: "ex-q02" },
        { id: "ex-q02-img-3", filename: "why.png", mimeType: "image/png", role: "explanation", questionId: "ex-q02" },
        { id: "ex-q02-img-4", filename: "figure-answer.png", mimeType: "image/png", role: "answer_reveal", questionId: "ex-q02", revealOf: "ex-q02-img-1" },
      ],
      flags: [{ type: "source_inconsistency", message: "The stem says 12 and the key says 21. Left as written." }],
      provenance: { method: "pdf-import", tool: "example@1", createdAt: "2026-10-08T00:00:00.000Z", sourceChecksum: "sha256:11", notes: "n" },
    };
    const original: ImportPackage = { manifest: read([]).package!.manifest, questions: [rich] };
    const text = serializeQuestionsFile(original);
    const back = parsePackage(serializeManifest(original.manifest), text);
    expect(back.issues).toEqual([]);
    expect(back.package).toEqual(original);
    expect(serializeQuestionsFile(back.package!)).toBe(text);
  });

  it("keeps a table row on one line so a change to one value is one changed line", () => {
    const text = serializeQuestionsFile(read([question({ stem: [{ type: "table", rows: [["Marker A", "12.0 mg/dL"], ["Marker B", "0.2 μU/mL"]] }] })]).package!);
    expect(text).toContain("[\"Marker A\", \"12.0 mg/dL\"],\n");
    expect(text.endsWith("}\n")).toBe(true);
  });
});

describe("filing", () => {
  it("takes the manifest's filing unless the question says otherwise", () => {
    const pkg = read([question(), question({ id: "ex-q02", week: 4, topic: "Own topic", subtopic: "Own subtopic" })]).package!;
    expect(questionScope(pkg.manifest, pkg.questions[0])).toEqual({ course: "EXAMPLE", term: 1, week: 3, bankId: "example-bank", discipline: "Example", topic: "Shapes" });
    expect(questionScope(pkg.manifest, pkg.questions[1])).toMatchObject({ week: 4, topic: "Own topic", subtopic: "Own subtopic" });
  });
});
