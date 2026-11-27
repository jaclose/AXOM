// @vitest-environment jsdom
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canonicalJson } from "../compressedText";
import * as vault from "../localVault";
import { resetLocalBackupRuntimeForTests } from "../localBackup";
import { sha256 } from "../question-content/assets";
import { closeWorkspace, openEmptyWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import { questionPracticeReadiness } from "../questionFilters";
import { deleteQuestionAttachmentBlobs, getQuestionAttachmentBlob } from "../questionAttachments";
import { useStore } from "../store";
import { PRIVATE_LIBRARY_FORMAT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank, type PrivateLibraryCatalog } from "../privateLibrary/types";
import { installPrivateLibrary, readPreparedBank } from "../privateLibrary/install";
import type { AcademicCourse, AcademicFile } from "./client";
import { downloadCourseQuestions, isAcademicCourseDownloaded } from "./downloadReference";

const mocks = vi.hoisted(() => ({ account: vi.fn(), assertCurrent: vi.fn(), dispose: vi.fn() }));
vi.mock("../account/supabase", async original => ({
  ...await original<typeof import("../account/supabase")>(), accountOperationClient: mocks.account,
}));
vi.mock("./accountScope", () => ({ academicAccountScope: (key: string) => ({ key, assertCurrent: mocks.assertCurrent, dispose: mocks.dispose }) }));
vi.mock("../../pages/QuestionWorkspacePage", () => ({ default: () => null }));

const accountId = "11111111-1111-4111-8111-111111111111";
const collectionId = "22222222-2222-4222-8222-222222222222";
const oldRevision = "33333333-3333-4333-8333-333333333333";
const newRevision = "44444444-4444-4444-8444-444444444444";
const checksum = "a".repeat(64);
const path = "banks/synthetic/bank.json";
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const course = (revision: string): AcademicCourse => ({ id: collectionId, current_revision_id: revision,
  title: "Synthetic source revision", term: "Term 5", module: "GOER", owned: true,
  visibility: "shared", review_status: "approved", ready_questions: revision === oldRevision ? 3 : 1, review_questions: revision === oldRevision ? 0 : 2 });

function makeBank(): PreparedBank {
  return readPreparedBank({ pkg: {
    manifest: { schemaVersion: 1, course: { name: "GOER", term: 5, week: 0 },
      bank: { id: "synthetic", title: "Synthetic revision bank", discipline: "Example" },
      source: { filename: "Synthetic source.txt", sourceWeekDeclared: false }, questionsFile: "questions.json", assetsDirectory: "assets" },
    questions: [1, 2, 3].map(index => ({ id: `synthetic-q${index}`, source: { filename: "Synthetic source.txt", questionNumber: index },
      stem: [{ type: "text", text: `Which synthetic label is first in example ${index}?` }],
      choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] },
        { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] }],
      correctAnswer: { labels: ["A"], evidence: "printed-key" }, explanation: [{ type: "text", text: "The original source explanation." }],
      assets: [], provenance: { method: "authored", sourceChecksum: `sha256:${checksum}` },
    })),
  }, sourceText: { rawText: "An invented source for source-update tests." }, sourceBytes: 100, notes: [], issues: [],
  reviewedFiling: { term: "Term 5", module: "GOER", evidence: "source-metadata", weekAssignment: "unassigned" } });
}

async function fixture() {
  const oldBank = makeBank(), nextBank = structuredClone(oldBank);
  nextBank.pkg.questions[0].explanation!.push({ type: "callout", tone: "note", text: "A clearly labelled supplemental source correction." });
  nextBank.pkg.questions[1].flags = [{ type: "answer_needs_review", message: "The source lacks the required context; hold this question." }];
  nextBank.pkg.questions[1].explanation!.push({ type: "callout", tone: "warning", text: "Source hold: missing context." });
  nextBank.pkg.questions[2].correctAnswer = { labels: ["B"], evidence: "explanation" };
  nextBank.pkg.questions[2].flags = [{ type: "answer_needs_review", message: "A proposed answer correction needs explicit review." }];
  nextBank.pkg.questions[2].explanation!.push({ type: "callout", tone: "warning", text: "Source A is preserved in history. Proposed B remains held." });
  const catalog = (version: string): PrivateLibraryCatalog => ({ format: PRIVATE_LIBRARY_FORMAT, schemaVersion: 1,
    id: "synthetic-revision", version, templates: [], sources: [{ id: "synthetic", name: "Synthetic source.txt",
      sourcePath: "Synthetic source.txt", checksum, bankFile: path, module: "GOER", status: "prepared",
      reason: "Synthetic source", ready: version === "old" ? 3 : 1, review: version === "old" ? 0 : 2 }] });
  const files = new Map<string, Map<string, Uint8Array>>([
    [oldRevision, new Map([["catalog.json", encode(catalog("old"))], [path, encode(oldBank)]])],
    [newRevision, new Map([["catalog.json", encode(catalog("new"))], [path, encode(nextBank)]])],
  ]);
  const manifests = new Map<string, AcademicFile[]>();
  async function refreshManifest(revision: string) {
    manifests.set(revision, await Promise.all([...files.get(revision)!].map(async ([filePath, bytes]) => {
      const hash = (await sha256(bytes)).slice(7);
      return { path: filePath, object_path: `${accountId}/${hash}`, sha256: hash, byte_size: bytes.length, mime_type: "application/json" };
    })));
  }
  await refreshManifest(oldRevision); await refreshManifest(newRevision);
  const state = { current: oldRevision, oldAccessible: true, oldCollection: collectionId, onRead: undefined as undefined | ((revision: string, path: string) => void) };
  const download = vi.fn(async (objectPath: string) => {
    for (const [revision, manifest] of manifests) {
      const entry = manifest.find(file => file.object_path === objectPath);
      if (!entry) continue;
      state.onRead?.(revision, entry.path);
      const bytes = files.get(revision)!.get(entry.path);
      return { data: bytes ? new Blob([bytes as BlobPart]) : null, error: bytes ? null : { message: "Missing source file" } };
    }
    return { data: null, error: { message: "Unknown file" } };
  });
  const client = {
    from: (table: string) => {
      const filters: Record<string, string> = {};
      const query = { select: () => query, eq: (key: string, value: string) => { filters[key] = value; return query; }, order: () => query,
        range: async (start: number, end: number) => {
          expect(table).toBe("academic_files");
          return { data: manifests.get(filters.revision_id)?.slice(start, end + 1), error: null };
        }, single: async () => {
          if (table === "academic_collections") return { data: filters.current_revision_id === state.current
            ? { id: collectionId, current_revision_id: state.current, withdrawn: false } : null, error: null };
          expect(table).toBe("academic_revisions");
          return { data: state.oldAccessible ? { id: filters.id, collection_id: state.oldCollection, status: "ready" } : null, error: null };
        } };
      return query;
    }, storage: { from: (bucket: string) => { expect(bucket).toBe("academic-content"); return { download }; } },
  } as unknown as SupabaseClient;
  mocks.account.mockResolvedValue({ userId: accountId, client });
  return { state, files, oldBank, nextBank, download, refreshManifest,
    installOld: () => downloadCourseQuestions(course(oldRevision), accountId),
    installNew: () => { state.current = newRevision; return downloadCourseQuestions(course(newRevision), accountId); },
  };
}

beforeEach(async () => {
  await openEmptyWorkspace(); resetLocalBackupRuntimeForTests();
  vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile);
  mocks.assertCurrent.mockReset(); mocks.account.mockReset();
});
afterEach(async () => { vi.restoreAllMocks(); resetLocalBackupRuntimeForTests(); await closeWorkspace(); vi.unstubAllGlobals(); });

it("updates the exact prior source, retracts ready questions, and preserves history, identity, notes and learner filing through reload/retry", async () => {
  const f = await fixture(); await f.installOld();
  const before = useStore.getState().questions;
  const setId = before[0].setId!;
  useStore.setState(state => ({
    questions: state.questions.map(question => ({ ...question, notes: "My reasoning", marked: true, tags: ["my-tag"],
      module: "Personal module", week: 7, courseId: "personal-course", status: "correct" as const, userAnswerKey: "A",
      attempts: [{ at: "2026-01-02T00:00:00.000Z", answerKey: "A", status: "correct" as const, note: "My original attempt" }] })),
    questionSets: state.questionSets.map(set => ({ ...set, title: "My set title", scope: { module: "Personal module", week: 7, courseId: "personal-course" } })),
  }));
  const receipt = await f.installNew();
  expect(receipt.status).toBe("complete"); expect(receipt.questionIds).toHaveLength(1);
  const saved = (await reloadWorkspace()).questions;
  expect(saved.map(question => question.id)).toEqual(before.map(question => question.id));
  expect(saved.filter(question => questionPracticeReadiness(question) === "ready")).toHaveLength(1);
  const first = saved.find(question => question.content?.id === "synthetic-q1")!;
  expect(first.explanation).toContain("supplemental source correction");
  for (const question of saved) expect(question).toMatchObject({ notes: "My reasoning", marked: true, tags: ["my-tag"],
    module: "Personal module", week: 7, courseId: "personal-course", setId, status: "correct", userAnswerKey: "A",
    attempts: [{ at: "2026-01-02T00:00:00.000Z", answerKey: "A", status: "correct", note: "My original attempt" }] });
  expect(saved.find(question => question.content?.id === "synthetic-q2")?.needsReview).toBe(true);
  expect(saved.find(question => question.content?.id === "synthetic-q3")).toMatchObject({ correctKey: "A", needsReview: true,
    content: { correctAnswer: { labels: ["B"], evidence: "explanation" } } });
  expect(useStore.getState().questionSets[0]).toMatchObject({ title: "My set title", scope: { module: "Personal module", week: 7 } });
  expect(isAcademicCourseDownloaded(course(newRevision), accountId, useStore.getState())).toBe(true);
  // Force the normal retry path to exercise reconciliation, not just the saved receipt fast path.
  useStore.getState().removeDocument(`academic-${newRevision}`);
  const snapshot = canonicalJson(useStore.getState().questions);
  await f.installNew();
  expect(canonicalJson(useStore.getState().questions)).toBe(snapshot);
});

it.each(["flat question", "native explanation", "local review", "local key"])("preserves a genuine %s edit and holds it without guessing a replacement", async kind => {
  const f = await fixture(); await f.installOld();
  const record = useStore.getState().questions.find(question => question.content?.id === "synthetic-q1")!;
  if (kind === "flat question") useStore.getState().updateQuestion(record.id, { stem: "My own edited question wording" });
  if (kind === "native explanation") {
    const content = structuredClone(record.content!); content.explanation = [{ type: "text", text: "My edited native explanation" }];
    useStore.getState().updateQuestion(record.id, { content, explanation: "My edited native explanation" });
  }
  if (kind === "local key") useStore.getState().updateQuestion(record.id, { correctKey: "B" });
  if (kind === "local review") {
    const document = useStore.getState().documents.find(item => item.fileType === PRIVATE_REVIEW_DOCUMENT)!;
    const edited = JSON.parse(document.rawText) as PreparedBank;
    edited.pkg.questions[0].explanation = [{ type: "text", text: "My unfinished review explanation" }];
    useStore.getState().updateDocument(document.id, { rawText: JSON.stringify(edited) });
  }
  await f.installNew();
  const saved = useStore.getState().questions.find(question => question.id === record.id)!;
  expect(saved.needsReview).toBe(true); expect(questionPracticeReadiness(saved)).not.toBe("ready");
  if (kind === "flat question") expect(saved.stem).toBe("My own edited question wording");
  if (kind === "native explanation") expect(saved.explanation).toContain("My edited native explanation");
  if (kind === "local key") expect(saved.correctKey).toBe("B");
  const review = useStore.getState().documents.find(item => item.fileType === PRIVATE_REVIEW_DOCUMENT)!;
  expect(review.rawText).toContain("Current verified source:");
  if (kind === "local review") expect(review.rawText).toContain("My unfinished review explanation");
  expect(saved.explanation).toContain("supplemental source correction");
  expect(useStore.getState().questions).toHaveLength(3);
});

it.each(["unavailable", "wrong collection", "wrong account", "damaged bytes"])("does not use an %s prior source as a trusted baseline", async reason => {
  const f = await fixture(); await f.installOld();
  if (reason === "unavailable") f.state.oldAccessible = false;
  if (reason === "wrong collection") f.state.oldCollection = "55555555-5555-4555-8555-555555555555";
  if (reason === "wrong account") {
    const reference = useStore.getState().documents.find(document => document.id === `academic-${oldRevision}`)!;
    useStore.getState().updateDocument(reference.id, { rawText: JSON.stringify({ ...JSON.parse(reference.rawText), accountId: "other-account" }) });
  }
  if (reason === "damaged bytes") f.files.get(oldRevision)!.set(path, encode({ changed: true }));
  await f.installNew();
  const saved = useStore.getState().questions.find(question => question.content?.id === "synthetic-q1")!;
  expect(saved.needsReview).toBe(true);
  expect(saved.content?.explanation?.[0]).toEqual({ type: "text", text: "The original source explanation." });
  expect(saved.explanation).toContain("Current verified source:");
  expect(saved.explanation).toContain("supplemental source correction");
});

it.each(["account", "current revision"])("refuses a stale %s before changing saved source content", async changed => {
  const f = await fixture(); await f.installOld();
  const before = canonicalJson(useStore.getState().questions);
  f.state.onRead = (revision, filePath) => {
    if (revision !== oldRevision || filePath !== path) return;
    if (changed === "account") mocks.assertCurrent.mockImplementation(() => { throw new Error("Account changed"); });
    else f.state.current = "55555555-5555-4555-8555-555555555555";
  };
  await expect(f.installNew()).rejects.toThrow(changed === "account" ? "Account changed" : "current accessible course revision");
  expect(canonicalJson(useStore.getState().questions)).toBe(before);
  mocks.assertCurrent.mockReset();
});

it("keeps the conservative local ZIP merge separate from authenticated source replacement", async () => {
  const f = await fixture(); await f.installOld();
  const before = canonicalJson(useStore.getState().questions);
  const result = await installPrivateLibrary(async filePath => f.files.get(newRevision)!.get(filePath)!);
  expect(result.status).toBe("partial"); expect(result.warnings.join(" ")).toContain("changed the structure");
  expect(canonicalJson(useStore.getState().questions)).toBe(before);
});

it.each(["missing new image", "damaged new image", "changed current bank"])("does not publish a complete or graded update when the %s fails integrity", async failure => {
  const f = await fixture(); await f.installOld();
  const before = canonicalJson(useStore.getState().questions);
  if (failure === "changed current bank") f.files.get(newRevision)!.set(path, encode({ changed: true }));
  else {
    const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
    const imageHash = await sha256(png), question = f.nextBank.pkg.questions[0];
    question.stem.push({ type: "image", assetId: "source-figure", role: "question" });
    question.assets.push({ id: "source-figure", questionId: question.id, filename: "figure.png", mimeType: "image/png", role: "question", checksum: imageHash });
    f.files.get(newRevision)!.set(path, encode(f.nextBank));
    f.files.get(newRevision)!.set("banks/synthetic/assets/figure.png", png);
    await f.refreshManifest(newRevision);
    if (failure === "missing new image") f.files.get(newRevision)!.delete("banks/synthetic/assets/figure.png");
    else f.files.get(newRevision)!.set("banks/synthetic/assets/figure.png", new Uint8Array([0]));
  }
  await expect(f.installNew()).rejects.toThrow(/incomplete|integrity/);
  if (failure === "changed current bank") expect(canonicalJson(useStore.getState().questions)).toBe(before);
  else {
    const saved = useStore.getState().questions.find(question => question.content?.id === "synthetic-q1")!;
    expect(saved.content?.assets).toEqual([]);
    expect(saved.needsReview).toBe(true);
    expect(saved.explanation).toContain("source images changed");
    expect(useStore.getState().questions.every(question => questionPracticeReadiness(question) !== "ready")).toBe(true);
  }
  expect(isAcademicCourseDownloaded(course(newRevision), accountId, useStore.getState())).toBe(false);
});

it("preserves a learner's explicit review hold even when the new source is ready", async () => {
  const f = await fixture(); await f.installOld();
  const question = useStore.getState().questions.find(record => record.content?.id === "synthetic-q1")!;
  useStore.getState().updateQuestion(question.id, { needsReview: true });
  const receipt = await f.installNew();
  expect(receipt.questionIds).toEqual([]);
  const saved = useStore.getState().questions.find(record => record.id === question.id)!;
  expect(saved.needsReview).toBe(true); expect(saved.explanation).toContain("supplemental source correction");
  expect(saved.explanation).toContain("Your existing review hold is preserved");
});

it("retracts a removed question with no bankId only through its verified prior receipt and leaves unrelated same-checksum work alone", async () => {
  const f = await fixture(); await f.installOld();
  const removed = useStore.getState().questions.find(question => question.content?.id === "synthetic-q1")!;
  expect(removed.content?.bankId).toBeUndefined();
  const unrelated = { ...structuredClone(removed), id: "unrelated-local-question", setId: undefined,
    content: { ...structuredClone(removed.content!), id: "unrelated-source-id" }, notes: "Unrelated learner work" };
  useStore.setState(state => ({ questions: [...state.questions, unrelated] }));
  f.nextBank.pkg.questions = structuredClone(f.oldBank.pkg.questions.filter(question => question.id !== "synthetic-q1"));
  f.files.get(newRevision)!.set(path, encode(f.nextBank));
  await f.refreshManifest(newRevision);
  const receipt = await f.installNew();
  const saved = (await reloadWorkspace()).questions;
  const retired = saved.find(question => question.id === removed.id)!;
  expect(retired.needsReview).toBe(true); expect(questionPracticeReadiness(retired)).not.toBe("ready");
  expect(retired.correctKey).toBe(removed.correctKey);
  expect(retired.stem).toBe(removed.stem);
  expect(retired.explanation).toContain("absent from the current source revision");
  expect(saved.find(question => question.id === unrelated.id)).toEqual(unrelated);
  expect(receipt.questionIds.sort()).toEqual(saved.filter(question => ["synthetic-q2", "synthetic-q3"].includes(question.content!.id)).map(question => question.id).sort());
  const localReview = useStore.getState().documents.find(document => document.fileType === PRIVATE_REVIEW_DOCUMENT)!;
  const reviewBank = JSON.parse(localReview.rawText) as PreparedBank;
  expect(reviewBank.pkg.questions.find(question => question.id === "synthetic-q1")?.flags)
    .toContainEqual(expect.objectContaining({ type: "answer_needs_review", message: expect.stringContaining("absent from the current source revision") }));
  useStore.getState().removeDocument(`academic-${newRevision}`);
  const beforeRetry = canonicalJson(saved);
  await f.installNew();
  expect(canonicalJson(useStore.getState().questions)).toBe(beforeRetry);
});

it("does not claim a complete removal update when the receipt-bound prior source cannot be verified", async () => {
  const f = await fixture(); await f.installOld();
  const before = canonicalJson(useStore.getState().questions);
  f.nextBank.pkg.questions = structuredClone(f.oldBank.pkg.questions.filter(question => question.id !== "synthetic-q1"));
  f.files.get(newRevision)!.set(path, encode(f.nextBank)); await f.refreshManifest(newRevision);
  f.state.oldAccessible = false;
  await expect(f.installNew()).rejects.toThrow("removed-question updates cannot be confirmed");
  expect(canonicalJson(useStore.getState().questions)).toBe(before);
  expect(isAcademicCourseDownloaded(course(newRevision), accountId, useStore.getState())).toBe(false);
});

it.each(["available", "unavailable"])("preserves image-bearing source identity and only completes with %s required image bytes", async availability => {
  const f = await fixture();
  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
  const checksum = await sha256(png);
  for (const [revision, bank] of [[oldRevision, f.oldBank], [newRevision, f.nextBank]] as const) {
    const question = bank.pkg.questions[0];
    question.stem.push({ type: "image", assetId: "source-figure", role: "question" });
    question.assets.push({ id: "source-figure", questionId: question.id, filename: "figure.png", mimeType: "image/png", role: "question", checksum });
    f.files.get(revision)!.set(path, encode(bank));
    f.files.get(revision)!.set("banks/synthetic/assets/figure.png", png);
    await f.refreshManifest(revision);
  }
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })));
  await f.installOld();
  const old = useStore.getState().questions.find(question => question.content?.id === "synthetic-q1")!;
  expect(old.content).toEqual(f.oldBank.pkg.questions[0]);
  expect(old.attachments).toHaveLength(1);
  useStore.getState().updateQuestion(old.id, { notes: "My figure interpretation" });
  await deleteQuestionAttachmentBlobs(old.attachments!.map(attachment => attachment.blobKey));
  expect(await getQuestionAttachmentBlob(old.attachments![0].blobKey)).toBeUndefined();
  if (availability === "unavailable") {
    f.files.get(newRevision)!.delete("banks/synthetic/assets/figure.png");
    // This image has the same immutable bytes in the old and new manifests.
    f.files.get(oldRevision)!.delete("banks/synthetic/assets/figure.png");
    const before = canonicalJson(useStore.getState().questions);
    await expect(f.installNew()).rejects.toThrow("incomplete");
    expect(canonicalJson(useStore.getState().questions)).toBe(before);
    expect(isAcademicCourseDownloaded(course(newRevision), accountId, useStore.getState())).toBe(false);
    return;
  }
  await f.installNew();
  const saved = useStore.getState().questions.find(question => question.id === old.id)!;
  expect(questionPracticeReadiness(saved)).toBe("ready");
  expect(saved.notes).toBe("My figure interpretation");
  expect(saved.explanation).toContain("supplemental source correction");
  expect(saved.content).toEqual(f.nextBank.pkg.questions[0]);
  expect(saved.attachments).toHaveLength(1);
  const restored = await getQuestionAttachmentBlob(saved.attachments![0].blobKey);
  expect(new Uint8Array(await restored!.blob.arrayBuffer())).toEqual(png);
});

it("rolls back a failed source snapshot without overwriting learner notes or publishing a complete receipt", async () => {
  const f = await fixture(); await f.installOld();
  const before = canonicalJson(useStore.getState().questions);
  const originalAssert = vault.assertVaultWritesSince;
  let failed = false;
  vi.spyOn(vault, "assertVaultWritesSince").mockImplementation(checkpoint => {
    const changed = useStore.getState().questions.some(question => question.explanation?.includes("supplemental source correction"));
    if (changed && !failed) {
      failed = true;
      const first = useStore.getState().questions[0];
      useStore.getState().updateQuestion(first.id, { notes: "Concurrent learner note" });
      throw new Error("Synthetic durable source write failure");
    }
    return originalAssert(checkpoint);
  });
  await expect(f.installNew()).rejects.toThrow("Synthetic durable source write failure");
  const after = (await reloadWorkspace()).questions;
  expect(after[0].notes).toBe("Concurrent learner note");
  const comparable = after.map(question => ({ ...question, notes: undefined, updatedAt: JSON.parse(before).find((old: { id: string }) => old.id === question.id).updatedAt }));
  expect(canonicalJson(comparable)).toBe(before);
  expect(isAcademicCourseDownloaded(course(newRevision), accountId, useStore.getState())).toBe(false);
});

it("holds an entire concurrent source projection after a failed save instead of restoring a graded hybrid", async () => {
  const f = await fixture(); await f.installOld();
  const originalAssert = vault.assertVaultWritesSince;
  let concurrent: ReturnType<typeof useStore.getState>["questions"][number] | undefined;
  vi.spyOn(vault, "assertVaultWritesSince").mockImplementation(checkpoint => {
    const updated = useStore.getState().questions.find(question => question.content?.id === "synthetic-q1"
      && question.explanation?.includes("supplemental source correction"));
    if (updated && !concurrent) {
      const content = structuredClone(updated.content!);
      content.stem = [{ type: "text", text: "Concurrent source wording" }];
      content.choices[1].blocks = [{ type: "text", text: "Concurrent Beta" }];
      content.correctAnswer = { labels: ["B"], evidence: "reviewer" };
      content.explanation = [{ type: "text", text: "Concurrent full source explanation" }];
      useStore.getState().updateQuestion(updated.id, { content, stem: "Concurrent source wording",
        options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Concurrent Beta" }],
        correctKey: "B", explanation: "Concurrent full source explanation", notes: "Concurrent note" });
      concurrent = useStore.getState().questions.find(question => question.id === updated.id)!;
      throw new Error("Synthetic concurrent source write failure");
    }
    return originalAssert(checkpoint);
  });
  await expect(f.installNew()).rejects.toThrow("Synthetic concurrent source write failure");
  const saved = (await reloadWorkspace()).questions.find(question => question.id === concurrent!.id)!;
  for (const key of ["content", "stem", "options", "correctKey", "correctAnswerText", "explanation", "notes"] as const)
    expect(saved[key]).toEqual(concurrent![key]);
  expect(saved.needsReview).toBe(true);
  expect(questionPracticeReadiness(saved)).not.toBe("ready");
  expect(saved.extraction?.warnings?.join(" ")).toContain("complete current wording and mapping are preserved and held");
  expect(isAcademicCourseDownloaded(course(newRevision), accountId, useStore.getState())).toBe(false);
});
