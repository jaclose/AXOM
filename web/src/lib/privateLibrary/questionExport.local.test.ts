// @vitest-environment jsdom
// Opt-in private acceptance. No source content or local path belongs in Git.
import { readFileSync, writeFileSync } from "node:fs";
import { File as NativeFile, Blob as NativeBlob } from "node:buffer";
import { afterEach, expect, it, vi } from "vitest";
import { zipLibraryReader } from "./fileInput";
import { installPrivateLibrary, readCatalog, readPreparedBank } from "./install";
import { assessBank } from "../question-content/assessBank";
import { openEmptyWorkspace, closeWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { useStore } from "../store";
import { PRIVATE_REVIEW_DOCUMENT } from "./types";
import { readImageInfo } from "../question-content/assets";
import JSZip from "jszip";

afterEach(async () => { await closeWorkspace(); vi.unstubAllGlobals(); });
it.skipIf(!process.env.AXOM_PRIVATE_BUNDLE)("installs every private export record and restores the same review queue without duplication", async () => {
  await openEmptyWorkspace();
  vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile);
  // Binary/header integrity is real here. Browser decoding is covered by the browser acceptance separately.
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => {
    const info = readImageInfo(new Uint8Array(await blob.arrayBuffer()));
    if (!info?.width || !info.height) throw new Error("Invalid image");
    return { width: info.width, height: info.height, close() {} };
  }));
  const file = new NativeFile([readFileSync(process.env.AXOM_PRIVATE_BUNDLE!)], "private-export.zip") as unknown as File;
  const read = await zipLibraryReader(file), catalog = readCatalog(JSON.parse(new TextDecoder().decode(await read("catalog.json"))));
  const counts = { total: 0, ready: 0, needsReview: 0, unresolved: 0, assetReferences: 0, explanations: 0 };
  const banks = [];
  const prepared = process.env.AXOM_PREPARED_OUTPUT ? new JSZip() : undefined;
  prepared?.file("catalog.json", Buffer.from(await read("catalog.json")));
  for (const source of catalog.sources) if (source.originalFile && prepared) prepared.file(source.originalFile, Buffer.from(await read(source.originalFile)));
  for (const source of catalog.sources) if (source.bankFile) {
    const bank = readPreparedBank(JSON.parse(new TextDecoder().decode(await read(source.bankFile))));
    const assessment = assessBank(bank.pkg, bank.issues, bank.pkg.questions.flatMap(q => q.assets.map(a => ({ name: a.filename }))));
    const assets = bank.pkg.questions.reduce((n, q) => n + q.assets.length, 0);
    if (prepared) {
      prepared.file(source.bankFile, JSON.stringify(bank));
      const prefix = source.bankFile.slice(0, source.bankFile.lastIndexOf("/") + 1);
      for (const filename of new Set(bank.pkg.questions.flatMap(q => q.assets.map(a => a.filename)))) {
        const path = `${prefix}assets/${filename}`;
        prepared.file(path, Buffer.from(await read(path)));
      }
    }
    banks.push({ bankId: bank.pkg.manifest.bank.id, total: bank.pkg.questions.length, ...assessment.counts, assets });
    counts.total += bank.pkg.questions.length; counts.ready += assessment.counts.ready; counts.needsReview += assessment.counts["needs-review"];
    counts.unresolved += assessment.counts.unresolved; counts.assetReferences += assets;
    counts.explanations += bank.pkg.questions.filter(q => q.explanation?.some(b => b.type === "text" && b.text.trim())).length;
  }
  const first = await installPrivateLibrary(read);
  expect(first.status, first.warnings.join("\n")).toBe("complete"); expect(first.warnings).toEqual([]);
  const snapshot = () => ({ questions: useStore.getState().questions.map(q => q.id).sort(),
    reviews: useStore.getState().documents.filter(d => d.fileType === PRIVATE_REVIEW_DOCUMENT).map(d => {
      const bank = readPreparedBank(JSON.parse(d.rawText));
      // Flags are an unordered set; all source text, choices, media and keys remain exact.
      for (const question of bank.pkg.questions) question.flags?.sort((a, b) => `${a.type}|${a.message}`.localeCompare(`${b.type}|${b.message}`));
      return [d.id, bank];
    }).sort() });
  const saved = snapshot();
  await reloadWorkspace(); expect(snapshot()).toEqual(saved);
  const second = await installPrivateLibrary(await zipLibraryReader(file));
  expect(second.status, second.warnings.join("\n")).toBe("complete"); expect(snapshot()).toEqual(saved);
  if (prepared) writeFileSync(process.env.AXOM_PREPARED_OUTPUT!, await prepared.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), { flag: "wx" });
  if (process.env.AXOM_ACCEPTANCE_REPORT) writeFileSync(process.env.AXOM_ACCEPTANCE_REPORT, JSON.stringify({ counts, banks,
    installation: { first: first.status, repeat: second.status, persistedQuestionCount: saved.questions.length, reviewDocuments: saved.reviews.length },
    limitations: ["Node integration uses a header-based image decoder; native browser decode is separately tested."] }, null, 2));
}, 120_000);
