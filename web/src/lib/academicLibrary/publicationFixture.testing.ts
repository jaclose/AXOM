// Test support, not app code: a synthetic prepared library in the shape
// scripts/prepare-private-library.ts writes. Every question is invented.
import { sha256 } from "../question-content/assets";
import type { PreparedBank, PrivateLibraryCatalog } from "../privateLibrary/types";

const text = (value: string) => new TextEncoder().encode(value);
const json = (value: unknown) => text(JSON.stringify(value));
const hex = async (bytes: Uint8Array) => (await sha256(bytes)).slice(7);

export function bank(id: string, module: string, term: number, sourceSha: string, questions = 1): PreparedBank {
  return {
    pkg: {
      manifest: { schemaVersion: 1, course: { name: module, term, week: 1 }, bank: { id, title: `${module} synthetic set`, discipline: "Example" },
        source: { filename: `${id}.pdf`, sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets" },
      questions: Array.from({ length: questions }, (_, index) => ({
        id: `${id}-q${index + 1}`, source: { filename: `${id}.pdf`, questionNumber: index + 1 },
        stem: [{ type: "text" as const, text: `Synthetic stem ${index + 1} for ${module}?` }],
        choices: [
          { id: "a", label: "A", blocks: [{ type: "text" as const, text: "First" }] },
          { id: "b", label: "B", blocks: [{ type: "text" as const, text: "Second" }] },
        ],
        correctAnswer: { labels: ["A"], evidence: "printed-key" as const },
        assets: [], provenance: { method: "authored" as const, sourceChecksum: `sha256:${sourceSha}` },
      })),
    },
    issues: [], sourceText: { rawText: "Synthetic, invented teaching source." }, sourceBytes: 36, notes: [],
  };
}

/** The shape scripts/prepare-private-library.ts writes: one catalog, many courses. */
export async function library(order: "forward" | "reverse" = "forward", version = "v1") {
  const files = new Map<string, Uint8Array>();
  const sources: PrivateLibraryCatalog["sources"] = [];
  const templates: PrivateLibraryCatalog["templates"] = [];
  const addTemplate = async (name: string, body: string, module?: string) => {
    const bytes = text(body); const checksum = await hex(bytes);
    files.set(`templates/${checksum}.txt`, bytes); files.set(`sources/${checksum}.txt`, bytes);
    templates.push({ file: `templates/${checksum}.txt`, name, checksum });
    sources.push({ id: `source-${checksum}`, name, sourcePath: `Templates/${name}`, checksum, ...(module ? { module } : {}),
      status: "reference/template-only", reason: "Available course template", originalFile: `sources/${checksum}.txt`, ready: 0, review: 0 });
  };
  const addBank = async (name: string, module: string, term: number, label = module, questions = 1) => {
    const original = text(`%PDF-1.4 synthetic ${name}`); const checksum = await hex(original);
    files.set(`sources/${checksum}.pdf`, original);
    files.set(`banks/${checksum}/bank.json`, json(bank(name, module, term, checksum, questions)));
    sources.push({ id: `source-${checksum}`, name: `${name}.pdf`, sourcePath: `${label}/${name}.pdf`, checksum, module: label,
      status: "prepared", reason: "Validated package", bankFile: `banks/${checksum}/bank.json`, originalFile: `sources/${checksum}.pdf`,
      ready: questions, review: 0 });
    return checksum;
  };
  const addOriginal = async (name: string, extension: string, module?: string) => {
    const bytes = text(`synthetic ${name}`); const checksum = await hex(bytes);
    files.set(`sources/${checksum}.${extension}`, bytes);
    sources.push({ id: `source-${checksum}`, name: `${name}.${extension}`, sourcePath: name, checksum, ...(module ? { module } : {}),
      status: "reference/template-only", reason: "Slides", originalFile: `sources/${checksum}.${extension}`, ready: 0, review: 0 });
  };
  await addTemplate("01_CPR1_Lectures_DLA.txt", "CPR 1 - Lectures + DLAs:\n\nLecture 01 Synthetic cardiac cycle [Lecture]\nDLA 02 Synthetic loops [DLA]\n", "CPR 1");
  await addTemplate("02_CPR1_SG.txt", "CPR1 - Small groups:\nWeek 1:\nSG 01 Synthetic case [Small Group]\nWeek 2:\nSG 02 Synthetic case [Small Group]\n", "CPR 1");
  await addTemplate("03_GOER_Lectures.txt", "T5 - GOER - Lectures:\nWeek 2:\nLecture 01 Synthetic hormones [Lecture]\n");
  await addTemplate("04_MSK_Broken.txt", "MSK - Lectures:\nThis line has no kind\n", "MSK");
  await addTemplate("05_XYZ_Lectures.txt", "XYZ - Lectures:\nLecture 1 Synthetic elective [Lecture]\n");
  const cprBank = await addBank("cpr1-imcq", "CPR 1", 1, "CPR 1", 2);
  await addBank("goer-pq", "GOER", 5);
  await addBank("ncrs-pq", "NCRS", 4);
  await addBank("unfiled-pq", "Unfiled", 0, "Unfiled");
  await addBank("mislabeled-pq", "ER", 2, "DM");
  await addOriginal("goer-slides", "pdf", "GOER");
  await addOriginal("goer-deck", "pptx", "GOER");
  await addOriginal("loose-notes", "pdf");
  sources.push({ id: "duplicate-copy", name: "cpr1-imcq copy.pdf", sourcePath: "Downloads/cpr1-imcq copy.pdf", checksum: cprBank,
    module: "CPR 1", status: "duplicate-linked", reason: "Identical bytes", duplicateOf: `source-${cprBank}`, ready: 0, review: 0 });
  sources.push({ id: "missing-source", name: "lost.pdf", sourcePath: "lost.pdf", checksum: "f".repeat(64), module: "GOER",
    status: "missing", reason: "Unavailable", ready: 0, review: 0 });
  const catalog: PrivateLibraryCatalog = { format: "axom-private-library", schemaVersion: 1, id: "academic-library", version, preparerVersion: 3,
    templates: order === "forward" ? templates : [...templates].reverse(), sources: order === "forward" ? sources : [...sources].reverse() };
  files.set("catalog.json", json(catalog));
  const read = async (path: string) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`Missing synthetic file ${path}`);
    return bytes;
  };
  return { read, files, catalog };
}
