// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createHash, webcrypto } from "node:crypto";
import { preflightQuestionMedia } from "../../lib/exam/mediaPreflight";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import type { PackageQuestion } from "../../lib/question-content/package";
import { STORAGE_KEYS } from "../../lib/brand";
import { ExamRunner } from "./ExamRunner";

const mocked = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  commitQuizRun: vi.fn(),
  recordQuestionAttempt: vi.fn(),
  saveQuizSession: vi.fn(),
  saveQuizBlock: vi.fn(),
  media: new Map<string, unknown>(),
}));
vi.mock("../../lib/store", () => ({ useStore: (selector?: (state: typeof mocked.store) => unknown) => selector ? selector(mocked.store) : mocked.store }));
vi.mock("../../lib/questionAttachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/questionAttachments")>()),
  getQuestionAttachmentBlob: vi.fn(async (key: string) => mocked.media.get(key)),
}));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../lib/ai", () => ({
  resolveActiveProvider: () => null, explainSimply: vi.fn(), explainWhyWrong: vi.fn(), memoryHook: vi.fn(),
}));

// Actual valid 2×2 synthetic RGBA PNG, not text mislabeled as image/png.
// Browser decoding of the exact fixture is independently covered in Chrome.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNQKtz5H4QZYAwATOAJLSYYSm0AAAAASUVORK5CYII=";
const pngBytes = Buffer.from(PNG_BASE64, "base64");
const bytes = new Blob([pngBytes], { type: "image/png" });
const checksum = `sha256:${createHash("sha256").update(pngBytes).digest("hex")}`;
const source: QuestionRecord = {
  id: "medical-figure-q1", source: "imported", stem: "Interpret the source histology figure.",
  options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }],
  correctKey: "B", status: "unseen", tags: [], attempts: [],
  createdAt: "2026-10-14", updatedAt: "2026-10-14",
  content: {
    id: "medical-figure-q1", stem: [{ type: "image", assetId: "stem-image" }],
    choices: [], assets: [{
      id: "stem-image", filename: "histology.png", role: "question",
      mimeType: "image/png", questionId: "medical-figure-q1", checksum,
    }],
  } as unknown as PackageQuestion,
  attachments: [{
    id: "attach-1", assetId: "stem-image", fileName: "histology.png", mimeType: "image/png",
    byteSize: bytes.size, blobKey: "blob-medical-figure",
    role: "question", altText: "Clinical histology figure", createdAt: "2026-10-14", updatedAt: "2026-10-14",
  }],
};

const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, String(value)); },
};

async function installFigure(questionId = source.id) {
  mocked.media.set("blob-medical-figure", {
    blob: bytes, mimeType: "image/png", byteSize: bytes.size,
    questionId, updatedAt: "2026-10-14",
  });
  // Validate the storage boundary independently of the React retry callback.
  // A fake-IndexedDB/JSDOM Blob that lost its bytes must never be treated as ready.
  const checked = await preflightQuestionMedia([source]);
  if (questionId === source.id) {
    expect(checked).toMatchObject({
      total: 1, available: 1, hashesVerified: 1, decoded: 1,
      issues: [], blockedQuestionIds: [], cancelled: false,
    });
  } else {
    expect(checked).toMatchObject({
      available: 0, blockedQuestionIds: [source.id],
      issues: [{ questionId: source.id, assetId: "stem-image", code: "wrong-question" }],
    });
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", storage);
  // JSDOM cannot decode PNG itself. Validate actual file signature + IHDR
  // before representing the real browser's bitmap decode in this unit test.
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)) throw new Error("Invalid PNG signature");
    const head = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = head.getUint32(16);
    const height = head.getUint32(20);
    if (!width || !height) throw new Error("Invalid PNG dimensions");
    return { width, height, close: vi.fn() };
  }));
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:synthetic"), configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
  values.clear();
  mocked.media.clear();
  mocked.store = {
    questions: [source], questionSets: [], documents: [], quizSessions: [], quizBlocks: [], tracker: [],
    profile: { name: "Synthetic exam taker" },
    recordQuestionAttempt: mocked.recordQuestionAttempt, commitQuizRun: mocked.commitQuizRun,
    saveQuizSession: mocked.saveQuizSession, saveQuizBlock: mocked.saveQuizBlock,
    updateQuestion: vi.fn(), addQuestionSet: vi.fn(), bulkAddTrackerItems: vi.fn(),
    addAnkiCards: vi.fn(() => ({ saved: 1, errors: [] })),
  };
});
afterEach(() => {
  cleanup();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ExamRunner clinical media integrity at session entry", () => {
  it("blocks a scored exam with a missing histology image, then recovers without changing selection", async () => {
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Start exam block" }));
    expect(await screen.findByText("Essential clinical figures are not ready")).toBeTruthy();
    expect(screen.getByText(/1 question cannot be scored safely/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Exam · 1 of 1" })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBeNull();
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();

    await installFigure();
    await user.click(screen.getByRole("button", { name: "Retry required figures" }));
    expect(await screen.findByRole("dialog", { name: "Exam · 1 of 1" })).toBeTruthy();
    expect(screen.getByText(source.stem)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "B. Beta" }));
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));
    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1);
    expect(mocked.commitQuizRun.mock.calls[0][0].session.score)
      .toMatchObject({ total: 1, scored: 1, correct: 1 });
  });

  it("does not discard suspended ExamSoft answers because their required figure is missing", async () => {
    const { writeSuspendedBlock, readSuspendedBlock } = await import("../../lib/examSim");
    const now = new Date().toISOString();
    writeSuspendedBlock({
      version: 1, skin: "examsoft", mode: "exam", poolIds: [source.id], index: 0,
      items: { [source.id]: { answerKey: "B", marked: true, struck: [], seconds: 3, visited: true } },
      elapsedMs: 3_000, timeLimitSeconds: 120, notes: "Preserve me",
      startedAt: now, suspendedAt: now,
    });
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByText("Essential clinical figures are not ready")).toBeTruthy();
    expect(readSuspendedBlock()?.items[source.id]).toMatchObject({ answerKey: "B", marked: true });
    expect(screen.queryByRole("dialog", { name: /ExamSoft.*simulation/ })).toBeNull();

    await installFigure();
    await user.click(screen.getByRole("button", { name: "Retry required figures" }));
    expect(await screen.findByRole("dialog", { name: /ExamSoft.*simulation/ })).toBeTruthy();
    expect(readSuspendedBlock()?.items[source.id]).toMatchObject({ answerKey: "B", marked: true });
  });

  it("withholds a restored native session while its source figure is absent, without rewriting the saved answers", async () => {
    const snapshot = {
      mode: "exam", runId: "clinical-figure-recovery", poolIds: [source.id], index: 0,
      answers: [], picked: "B", revealed: false, startedAt: new Date().toISOString(),
      timed: false, filters: { count: 1, status: "all", ordered: true },
    };
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify(snapshot));
    const user = userEvent.setup();
    render(<ExamRunner mode="exam" onClose={vi.fn()} />);
    expect(await screen.findByRole("dialog", { name: "Verify essential clinical figures" })).toBeTruthy();
    expect(await screen.findByText("Essential clinical figures are not ready")).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBe(JSON.stringify(snapshot));
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
    await installFigure();
    await user.click(screen.getByRole("button", { name: "Retry required figures" }));
    expect(await screen.findByRole("dialog", { name: "Exam · 1 of 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "B. Beta" }).getAttribute("aria-pressed")).toBe("true");
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
  });
});

describe("Round 4 recovery causes and hydrated React media dependencies", () => {
  it("rejects a JSDOM/fake-indexeddb-style clone that lost Blob bytes even though metadata still claims their size", async () => {
    mocked.media.set("blob-medical-figure", {
      blob: {} as Blob, mimeType: "image/png", byteSize: bytes.size,
      questionId: source.id, updatedAt: "2026-10-14",
    });
    const verified = await preflightQuestionMedia([source]);
    expect(verified.issues).toEqual([
      { questionId: source.id, assetId: "stem-image", code: "size-mismatch" },
    ]);
    expect(verified.available).toBe(0);
    expect(verified.blockedQuestionIds).toEqual([source.id]);
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
  });

  it("rejects same-length PNG-labelled bytes if their source SHA-256 differs", async () => {
    const fake = new Blob([new Uint8Array(bytes.size)], { type: "image/png" });
    mocked.media.set("blob-medical-figure", {
      blob: fake, mimeType: "image/png", byteSize: fake.size,
      questionId: source.id, updatedAt: "2026-10-14",
    });
    const verified = await preflightQuestionMedia([source]);
    expect(verified.issues).toEqual([
      { questionId: source.id, assetId: "stem-image", code: "checksum-mismatch" },
    ]);
    expect(verified.available).toBe(0);
  });

  it("uses the newly hydrated original question pool for validation, then resumes identical selected answers exactly once", async () => {
    const snapshot = {
      mode: "exam", runId: "late-hydrated-clinical-figure", poolIds: [source.id], index: 0,
      answers: [], picked: "B", revealed: false, startedAt: new Date().toISOString(),
      timed: false, filters: { count: 1, status: "all", ordered: true },
    };
    localStorage.setItem(STORAGE_KEYS.quizActiveSession, JSON.stringify(snapshot));
    mocked.store = { ...mocked.store, questions: [] };
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<ExamRunner mode="exam" onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Recover your saved question block" })).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBe(JSON.stringify(snapshot));

    // Same mounted runner, but the vault asynchronously restores original question data.
    mocked.store = { ...mocked.store, questions: [source] };
    rerender(<ExamRunner mode="exam" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("Essential clinical figures are not ready")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "B. Beta" })).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.quizActiveSession)).toBe(JSON.stringify(snapshot));
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();

    await installFigure();
    await user.click(screen.getByRole("button", { name: "Retry required figures" }));
    expect(await screen.findByRole("dialog", { name: "Exam · 1 of 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "B. Beta" }).getAttribute("aria-pressed")).toBe("true");
    expect(mocked.commitQuizRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Submit & finish" }));
    expect(mocked.commitQuizRun).toHaveBeenCalledTimes(1);
    const committed = mocked.commitQuizRun.mock.calls[0][0];
    expect(committed.session.questionIds).toEqual([source.id]);
    expect(committed.session.id).toBe(snapshot.runId);
    expect(committed.session.score).toMatchObject({ total: 1, scored: 1, correct: 1 });
  });
});
