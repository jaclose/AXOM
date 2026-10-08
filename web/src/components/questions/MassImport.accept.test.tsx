// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_NAME } from "../../lib/localVault";
import { skippedImports } from "../../lib/importSkips";
import { saveReviewedImport } from "../../lib/questionImportSave";
import { useStore } from "../../lib/store";
import { pushToast } from "../../lib/toast";
import { MassImport } from "./MassImport";

// Accept, Skip and Accept all valid, against the real store: what is saved,
// that it is saved through the review screen's own path, and that doing it
// again adds nothing. All content is invented.

vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));
// A checksum that follows the bytes, so the same file is recognised and a changed one is not.
vi.mock("../../lib/checksum", () => ({
  sha256Hex: vi.fn(async (buffer: ArrayBuffer) => `sha-${[...new Uint8Array(buffer)].reduce((hash, byte) => (hash * 31 + byte) >>> 0, 7).toString(16)}`),
}));
vi.mock("../../lib/questionImportSave", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/questionImportSave")>();
  return { ...actual, saveReviewedImport: vi.fn(actual.saveReviewedImport) };
});

const original = {
  questions: useStore.getState().questions,
  questionSets: useStore.getState().questionSets,
  documents: useStore.getState().documents,
  courses: useStore.getState().courses,
  terms: useStore.getState().terms,
};

const localValues = new Map<string, string>();
const localStorageStub: Storage = {
  get length() { return localValues.size; },
  clear: () => localValues.clear(),
  getItem: (key) => localValues.get(key) ?? null,
  key: (index) => [...localValues.keys()][index] ?? null,
  removeItem: (key) => { localValues.delete(key); },
  setItem: (key, value) => { localValues.set(key, String(value)); },
};

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = fakeIndexedDb.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  localValues.clear();
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal("localStorage", localStorageStub);
  await deleteDatabase(DB_NAME);
  await useStore.setState({ questions: [], questionSets: [], documents: [], courses: [], terms: [] });
});
afterEach(async () => {
  cleanup();
  await useStore.setState(original);
  vi.unstubAllGlobals();
});

const VEIN = ["Which vessel carries oxygenated blood from the lungs to the heart?", "A. Pulmonary vein", "B. Pulmonary artery", "C. Aorta", "D. Vena cava", "Answer: A", "Explanation: The pulmonary veins return oxygenated blood to the left atrium."];
const NERVE = ["Which nerve supplies the diaphragm?", "A. Vagus nerve", "B. Phrenic nerve", "C. Intercostal nerve", "D. Accessory nerve", "Answer: B", "Explanation: The phrenic nerve arises from the third to fifth cervical roots."];
const HORMONE = ["Which hormone lowers the concentration of glucose in blood?", "A. Glucagon", "B. Cortisol", "C. Insulin", "D. Adrenaline", "Answer: C", "Explanation: Insulin moves glucose into muscle and fat."];
const BONE = ["Which bone forms the heel of the foot?", "A. Talus", "B. Calcaneus", "C. Navicular", "D. Cuboid", "Answer: B", "Explanation: The calcaneus is the largest tarsal bone."];

const text = (...questions: string[][]) => questions.map((lines, index) => [`${index + 1}. ${lines[0]}`, ...lines.slice(1)].join("\n")).join("\n\n");
const file = (name: string, contents: string) => new File([contents], name, { type: "text/plain" });
const row = (name: string) => screen.getByText(name).closest(".import-draft") as HTMLElement;

async function add(user: ReturnType<typeof userEvent.setup>, ...files: File[]) {
  await user.upload(screen.getByLabelText("Choose multiple question files"), files);
  await user.click(screen.getByRole("button", { name: "Import files" }));
  await waitFor(() => expect(screen.queryByText("queued")).toBeNull());
  await waitFor(() => expect(screen.queryByText("parsing")).toBeNull());
}

const counts = () => {
  const state = useStore.getState();
  return [state.questions.length, state.questionSets.length, state.documents.length];
};

describe("Mass import: accept", () => {
  it("saves a ready file through the review screen's own save path", async () => {
    const user = userEvent.setup();
    render(<MassImport onInspect={vi.fn()} />);
    await add(user, file("thorax.txt", text(VEIN, NERVE)));
    expect(within(row("thorax.txt")).getByText("ready to accept")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Accept thorax.txt" }));
    await waitFor(() => expect(within(row("thorax.txt")).getByText("accepted")).toBeTruthy());

    expect(saveReviewedImport).toHaveBeenCalledTimes(1);
    const state = useStore.getState();
    expect(counts()).toEqual([2, 1, 1]);
    const [set] = state.questionSets;
    const [document] = state.documents;
    expect(set).toMatchObject({ title: "thorax", kind: "source", sourceDocumentIds: [document.id] });
    expect(document).toMatchObject({ fileName: "thorax.txt", libraryOnly: false, linkedQuestionSetIds: [set.id] });
    expect(set.questionIds.map((id) => state.questions.find((question) => question.id === id)).map((question) => [question?.correctKey, question?.bank, question?.sourceDocumentId, question?.extraction?.reviewed]))
      .toEqual([["A", "thorax", document.id, true], ["B", "thorax", document.id, true]]);

    // The row says what went in, and offers nothing more to do with it.
    expect(within(row("thorax.txt")).getByText(/2 questions saved/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept thorax.txt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit thorax.txt" })).toBeNull();
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "thorax.txt accepted", tone: "success" }));
  });

  it("accepts every valid file in one action and leaves the others to review", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<MassImport onInspect={onInspect} />);
    await add(user,
      file("thorax.txt", text(VEIN, NERVE)),
      file("endocrine.txt", text(HORMONE)),
      file("unanswered.txt", text(BONE.filter((line) => !line.startsWith("Answer:")))),
    );
    expect(screen.queryByRole("button", { name: "Accept unanswered.txt" })).toBeNull();
    expect(within(row("unanswered.txt")).getByText("1 question has no certain answer.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Accept all valid (2)" }));
    await waitFor(() => expect(screen.getByText("Accepted 2")).toBeTruthy());

    expect(saveReviewedImport).toHaveBeenCalledTimes(2);
    expect(counts()).toEqual([3, 2, 2]);
    expect(useStore.getState().questionSets.map((set) => set.title).sort()).toEqual(["endocrine", "thorax"]);
    expect(screen.queryByRole("button", { name: /Accept all valid/ })).toBeNull();
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "2 files accepted", tone: "success" }));

    // The file that needs a decision is still there, still editable, and nothing of it was saved.
    await user.click(screen.getByRole("button", { name: "Edit unanswered.txt" }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ fileName: "unanswered.txt", drafts: [expect.objectContaining({ correctKey: undefined })] }));
  });

  it("does not save the same questions twice when two queued files hold them", async () => {
    const user = userEvent.setup();
    render(<MassImport onInspect={vi.fn()} />);
    // The same questions under another name, with a blank line more: other bytes, same content.
    await add(user, file("thorax.txt", text(VEIN, NERVE)), file("thorax copy.txt", `${text(VEIN, NERVE)}\n\n`));
    await user.click(screen.getByRole("button", { name: "Accept all valid (2)" }));
    await waitFor(() => expect(screen.getByText("Accepted 1")).toBeTruthy());

    expect(counts()).toEqual([2, 1, 1]);
    expect(saveReviewedImport).toHaveBeenCalledTimes(1);
    // The queue reads in name order, so the copy went in first and the other file is the one held back.
    expect(within(row("thorax copy.txt")).getByText("accepted")).toBeTruthy();
    expect(within(row("thorax.txt")).getByText("2 questions are already in your bank, or close to one that is.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept thorax.txt" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit thorax.txt" })).toBeTruthy();
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "1 file accepted", tone: "warn" }));
  });

  it("files an accepted set under the module and week its name settles, and holds back a name that settles nothing", async () => {
    await useStore.setState({
      terms: [{ id: "term-1", name: "Term 1" }] as never,
      courses: [{ id: "course-1", termId: "term-1", code: "BPM 500", name: "Basic principles", files: 0, modules: [{ id: "m-1", name: "FTM 1" }] }] as never,
    });
    const user = userEvent.setup();
    render(<MassImport onInspect={vi.fn()} />);
    await add(user, file("FTM 1 Week 3 Quiz 2.txt", text(VEIN)), file("loose notes.txt", text(NERVE)));

    expect(within(row("loose notes.txt")).getByText("Its module and week are not settled from the file's name.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept loose notes.txt" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Accept all valid (1)" }));
    await waitFor(() => expect(screen.getByText("Accepted 1")).toBeTruthy());
    const state = useStore.getState();
    expect(state.questionSets).toHaveLength(1);
    expect(state.questionSets[0].scope).toEqual({ module: "FTM 1", week: 3, courseId: "course-1" });
    expect(state.questions[0]).toMatchObject({ module: "FTM 1", week: 3, courseId: "course-1" });
  });
});

describe("Mass import: doing it again", () => {
  it("shows a file accepted before as already imported, and adds nothing", async () => {
    const user = userEvent.setup();
    const first = render(<MassImport onInspect={vi.fn()} />);
    await add(user, file("thorax.txt", text(VEIN, NERVE)));
    await user.click(screen.getByRole("button", { name: "Accept thorax.txt" }));
    await waitFor(() => expect(counts()).toEqual([2, 1, 1]));
    first.unmount();

    // Another session, the same folder.
    render(<MassImport onInspect={vi.fn()} />);
    await add(user, file("thorax.txt", text(VEIN, NERVE)));
    expect(within(row("thorax.txt")).getByText("already imported")).toBeTruthy();
    expect(within(row("thorax.txt")).getByText("This file was imported before. Open it to see what is already in your bank.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept thorax.txt" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept all valid/ })).toBeNull();
    expect(counts()).toEqual([2, 1, 1]);
  });

  it("holds back a changed version of an imported file for the learner to open", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    const first = render(<MassImport onInspect={vi.fn()} />);
    await add(user, file("thorax.txt", text(VEIN, NERVE)));
    await user.click(screen.getByRole("button", { name: "Accept thorax.txt" }));
    await waitFor(() => expect(counts()).toEqual([2, 1, 1]));
    first.unmount();

    render(<MassImport onInspect={onInspect} />);
    await add(user, file("thorax.txt", text(VEIN, NERVE, HORMONE)));
    expect(within(row("thorax.txt")).getByText("changed since import")).toBeTruthy();
    expect(within(row("thorax.txt")).getByText("A different version of this file was imported before. Open it to bring in only what is new.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept thorax.txt" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit thorax.txt" }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ fileName: "thorax.txt", drafts: expect.arrayContaining([expect.objectContaining({ correctKey: "C" })]) }));
    expect(counts()).toEqual([2, 1, 1]);
  });

  it("keeps a skipped file skipped when it is added again, in view, until the learner asks for it", async () => {
    const user = userEvent.setup();
    const first = render(<MassImport onInspect={vi.fn()} />);
    await add(user, file("thorax.txt", text(VEIN, NERVE)), file("endocrine.txt", text(HORMONE)));
    await user.click(screen.getByRole("button", { name: "Skip thorax.txt" }));
    expect(within(row("thorax.txt")).getByText("skipped")).toBeTruthy();
    expect(skippedImports().map((entry) => entry.fileName)).toEqual(["thorax.txt"]);
    // Skipped means out of the queue's work: one valid file left.
    expect(screen.getByRole("button", { name: "Accept all valid (1)" })).toBeTruthy();
    first.unmount();

    render(<MassImport onInspect={vi.fn()} />);
    await add(user, file("thorax.txt", text(VEIN, NERVE)));
    expect(within(row("thorax.txt")).getByText("skipped")).toBeTruthy();
    expect(screen.getByText("Skipped 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept thorax.txt" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept all valid/ })).toBeNull();
    expect(counts()).toEqual([0, 0, 0]);

    await user.click(screen.getByRole("button", { name: "Review thorax.txt anyway" }));
    expect(within(row("thorax.txt")).getByText("ready to accept")).toBeTruthy();
    expect(skippedImports()).toEqual([]);
  });
});
