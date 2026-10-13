// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob, File as NativeFile } from "node:buffer";
import { useStore } from "../store";
import { closeWorkspace, openEmptyWorkspace, reloadWorkspace } from "../question-content/persistenceHarness.testing";
import type { PreparedBank } from "../privateLibrary/types";
import type { CatalogCourse, CatalogEntry } from "./model";
import { loadCloudCourse, prepareCloudQuiz } from "./load";
const mock = vi.hoisted(() => ({ read: vi.fn(), user: null as string | null, listener: undefined as undefined | ((_event: string, session: any) => void) }));
vi.mock("./client", () => ({
  readCloudFile: (...args: unknown[]) => mock.read(...args),
  catalogClient: async () => ({ auth: {
    getSession: async () => ({ data: { session: mock.user ? { user: { id: mock.user } } : null }, error: null }),
    onAuthStateChange: (callback: any) => { mock.listener = callback; return { data: { subscription: { unsubscribe: () => { mock.listener = undefined; } } } }; },
  } }),
}));
const release = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entry: CatalogEntry = { release_id: release, id: "bank", kind: "bank", title: "Synthetic practice", module: "GOER", term: "Term 5", week: 2,
  question_count: 1, image_question_count: 0, activity_count: 0, payload_path: "banks/test/bank.json", source_label: "synthetic.txt" };
function bank(): PreparedBank {
  return { pkg: { manifest: { schemaVersion: 1, course: { name: "GOER", term: 5, week: 2 },
    bank: { id: "catalog-test", title: "Synthetic practice", discipline: "Test" },
    source: { filename: "synthetic.txt", sourceWeekDeclared: true }, questionsFile: "questions.json", assetsDirectory: "assets" },
    questions: [{ id: "q1", source: { filename: "synthetic.txt", questionNumber: 1 }, stem: [{ type: "text", text: "Which item is labeled first?" }],
      choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "First" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "Second" }] }],
      correctAnswer: { labels: ["A"], evidence: "printed-key" }, assets: [], provenance: { method: "authored", sourceChecksum: `sha256:${"a".repeat(64)}` } }] },
    issues: [], sourceText: { rawText: "Synthetic test source." }, sourceBytes: 22, notes: [] };
}
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
beforeEach(async () => {
  await openEmptyWorkspace(); vi.stubGlobal("Blob", NativeBlob); vi.stubGlobal("File", NativeFile);
  mock.read.mockReset(); mock.user = null; mock.listener = undefined;
  mock.read.mockResolvedValue(encode(bank()));
});
afterEach(async () => { await closeWorkspace(); vi.unstubAllGlobals(); });
describe("cloud content into canonical learner stores", () => {
  it("creates usable scoped practice, survives reload, and reuses edited questions", async () => {
    const first = await prepareCloudQuiz([entry], 20, new AbortController().signal);
    expect(first.count).toBe(1); expect(first.setIds).toHaveLength(1);
    expect(first.questionIds).toEqual(useStore.getState().questions.map(q => q.id));
    await reloadWorkspace();
    const question = useStore.getState().questions[0];
    useStore.getState().updateQuestion(question.id, { notes: "My own note", stem: "My clarified wording?" });
    const again = await prepareCloudQuiz([entry, entry], 20, new AbortController().signal);
    await reloadWorkspace();
    expect(again.setIds).toEqual(first.setIds); expect(again.questionIds).toEqual(first.questionIds); expect(useStore.getState().questions).toHaveLength(1);
    expect(useStore.getState().questions[0]).toMatchObject({ id: question.id, notes: "My own note", stem: "My clarified wording?" });
  });
  it("activates the published course only on request and preserves tracker progress", async () => {
    const raw = "T5 - GOER - Lectures:\nWeek 2:\nLecture 01 Synthetic example [Lecture]\n";
    mock.read.mockResolvedValue(encode(raw));
    const template: CatalogEntry = { ...entry, id: "template", kind: "template", payload_path: "templates/test.txt", question_count: 0, activity_count: 1 };
    const course: CatalogCourse = { key: "test", module: "GOER", term: "Term 5", entries: [template] };
    await loadCloudCourse(course, new AbortController().signal);
    const activity = useStore.getState().tracker.find(t => t.templateKey)!;
    expect(activity).toBeDefined();
    useStore.getState().updateTrackerItem(activity.id, { passes: 2, label: "Personal title" });
    await loadCloudCourse(course, new AbortController().signal); await reloadWorkspace();
    expect(useStore.getState().tracker.filter(t => t.templateKey)).toHaveLength(1);
    expect(useStore.getState().tracker.find(t => t.id === activity.id)).toMatchObject({ passes: 2, label: "Personal title" });
  });
  it("rejects held answers and inconsistent scope before storing questions", async () => {
    const held = bank(); held.pkg.questions[0].correctAnswer!.evidence = "explanation";
    mock.read.mockResolvedValue(encode(held));
    await expect(prepareCloudQuiz([entry], 1, new AbortController().signal)).rejects.toThrow(/readiness/);
    mock.read.mockResolvedValue(encode(bank()));
    await expect(prepareCloudQuiz([{ ...entry, week: 3 }], 1, new AbortController().signal)).rejects.toThrow(/scope/);
    expect(useStore.getState().questions).toHaveLength(0);
  });
  it("does not mutate a different account when sign-in changes during download", async () => {
    mock.user = "account-a";
    mock.read.mockImplementation(async () => {
      mock.user = "account-b"; mock.listener?.("SIGNED_IN", { user: { id: mock.user } }); return encode(bank());
    });
    await expect(prepareCloudQuiz([entry], 1, new AbortController().signal)).rejects.toThrow(/account changed/);
    expect(useStore.getState().questions).toHaveLength(0);
  });
  it("refuses empty selections and propagates aborted transfers", async () => {
    await expect(prepareCloudQuiz([], 1, new AbortController().signal)).rejects.toThrow(/Select/);
    const controller = new AbortController(); controller.abort();
    await expect(prepareCloudQuiz([entry], 1, controller.signal)).rejects.toThrow();
    expect(useStore.getState().questions).toHaveLength(0);
  });
});
