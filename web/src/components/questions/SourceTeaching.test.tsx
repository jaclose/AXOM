// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../../lib/ai/types";
import { questionSourceFingerprint, type QuestionAnalysis } from "../../lib/decode";
import type { SourceDocument } from "../../lib/library";
import type { QuestionRecord } from "../../lib/questions";
import { SourceTeaching } from "./SourceTeaching";

const sources = vi.hoisted(() => ({ read: vi.fn(async (): Promise<Blob | undefined> => undefined), save: vi.fn(async () => {}) }));
vi.mock("../../lib/decode", async (original) => ({
  ...await original<typeof import("../../lib/decode")>(),
  readSourceOriginal: sources.read,
  saveSourceOriginal: sources.save,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Invented teaching content. No real course material is used in tests.
const slide = (...lines: string[]) => lines.join("\n");
const STEMS = [
  ["A 54-year-old man has crushing chest pain that spreads to his left arm.", "His electrocardiogram shows ST elevation in leads II, III and aVF.", "Which coronary artery is most likely blocked?"],
  ["A 23-year-old woman has a fever, a new murmur and painful spots on her fingertips.", "Blood cultures grow gram-positive cocci in clusters.", "Which valve is most likely infected?"],
  ["A 67-year-old man faints while climbing a flight of stairs.", "He has a harsh systolic murmur that spreads to the neck.", "What is the most likely diagnosis?"],
];
const OPTIONS = [
  ["A. Left anterior descending", "B. Left circumflex", "C. Right coronary", "D. Left main"],
  ["A. Aortic valve", "B. Mitral valve", "C. Pulmonary valve", "D. Tricuspid valve"],
  ["A. Aortic stenosis", "B. Mitral regurgitation", "C. Hypertrophic cardiomyopathy", "D. Atrial septal defect"],
];
const questionSlide = (index: number) => slide(`${index + 1}. ${STEMS[index][0]}`, ...STEMS[index].slice(1), ...OPTIONS[index]);
const teaching = slide("Inferior wall infarction", "WHY IT'S RIGHT", "Leads II, III and aVF look at the inferior wall.",
  "WHY NOT THE OTHERS", "A. The left anterior descending supplies the anterior wall.", "B. The circumflex supplies the lateral wall.",
  "HIGH-YIELD", "Match the leads to the wall, then the wall to the artery.");
const pages = [questionSlide(0), questionSlide(0), teaching, questionSlide(1), questionSlide(1), questionSlide(2), questionSlide(2)];
const source: SourceDocument = {
  id: "doc-1", title: "Cardiology review", fileName: "cardiology-review.pdf", fileType: "pdf", uploadedAt: "2026-10-01T09:00:00.000Z",
  rawText: pages.join("\n\n"), pageTexts: pages, sizeBytes: 1000, checksum: "checksum-1", tags: [], linkedQuestionSetIds: [], libraryOnly: false,
};
const imported = (index: number, page: number, patch: Partial<QuestionRecord> = {}): QuestionRecord => ({
  id: `q-${index + 1}`, source: "pdf", stem: STEMS[index].join(" "),
  options: OPTIONS[index].map((line) => ({ key: line[0], text: line.slice(3) })),
  correctKey: "C", status: "incorrect", tags: [], attempts: [], sourceDocumentId: "doc-1", sourcePage: page,
  createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...patch,
});
const first = imported(0, 1);
const siblings = [first, imported(1, 4), imported(2, 6)];
const provider = (answer: () => unknown): AIProvider => ({
  info: { kind: "mock", label: "Test model", local: true, requiresKey: false },
  available: async () => ({ ok: true, detail: "" }),
  completeJson: async () => answer(),
});

describe("what the source teaches, after an answer", () => {
  it("offers what the source's own slides say as a proposal, and stores nothing until the learner decides", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SourceTeaching question={first} document={source} siblings={siblings} onChange={onChange} />);

    expect(screen.getByText("From the source's slides")).toBeTruthy();
    expect(screen.getByText("Match the leads to the wall, then the wall to the artery.")).toBeTruthy();
    expect(screen.getByText("Why A is not the answer")).toBeTruthy();
    expect(screen.getByText(/Check it against the page, then keep it or discard it/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep" }));
    const [kept] = onChange.mock.calls[0][0] as QuestionAnalysis[];
    expect(kept).toMatchObject({ id: "source-q-1", origin: "source", status: "reviewed", sourceFingerprint: questionSourceFingerprint(first, source) });
  });

  it("shows kept teaching as teaching, and remembers a discarded reading so it is not offered again", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const view = render(<SourceTeaching question={first} document={source} siblings={siblings} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const discarded = onChange.mock.calls[0][0] as QuestionAnalysis[];
    expect(discarded[0].status).toBe("rejected");

    view.rerender(<SourceTeaching question={{ ...first, analyses: discarded }} document={source} siblings={siblings} onChange={onChange} />);
    expect(screen.queryByText("From the source's slides")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.queryByText("Match the leads to the wall, then the wall to the artery.")).toBeNull();

    const reviewed = [{ ...discarded[0], status: "reviewed" as const }];
    view.rerender(<SourceTeaching question={{ ...first, analyses: reviewed }} document={source} siblings={siblings} onChange={onChange} />);
    expect(screen.getByText("From the source")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("lets a discard or a removal be taken back while the question is on screen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const reviewed: QuestionRecord = { ...first, analyses: undefined };
    const view = render(<SourceTeaching question={reviewed} document={source} siblings={siblings} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    const discarded = onChange.mock.calls[0][0] as QuestionAnalysis[];
    view.rerender(<SourceTeaching question={{ ...first, analyses: discarded }} document={source} siblings={siblings} onChange={onChange} />);

    expect(screen.getByRole("status").textContent).toBe("Proposal discarded.");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    // The question's analyses go back to what they were: nothing stored, so the reading is offered again.
    expect(onChange.mock.calls[1][0]).toBeUndefined();
    view.rerender(<SourceTeaching question={first} document={source} siblings={siblings} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("shows nothing when the source has no headed teaching and there is no model to ask", () => {
    const view = render(<SourceTeaching question={siblings[1]} document={source} siblings={siblings} onChange={() => {}} />);
    expect(view.container.innerHTML).toBe("");
  });

  it("does not repeat what the question already says about an option", () => {
    const told = { ...first, choiceRationales: { A: "The left anterior descending supplies the anterior wall." } };
    render(<SourceTeaching question={told} document={source} siblings={[told, ...siblings.slice(1)]} onChange={() => {}} />);
    expect(screen.queryByText("Why A is not the answer")).toBeNull();
    expect(screen.getByText("Why B is not the answer")).toBeTruthy();
  });

  it("asks a model only when the learner asks, and keeps its checked reply as a proposal", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const bare = siblings[1];
    const reply = {
      concept: "Right-sided endocarditis", task: "Name the valve.", rule: "Venous entry, right-sided valve.", explanation: "Injected organisms reach the right side first.",
      decisiveClues: [], mechanism: [], distractors: [{ key: "A", whyWrong: "Left sided.", wouldFitIf: "" }],
      references: [{ documentId: "doc-1", page: 4, quote: "Blood cultures grow gram-positive cocci in clusters.", role: "question" }],
    };
    const complete = vi.fn(() => reply);
    render(<SourceTeaching question={bare} document={source} siblings={siblings} provider={provider(complete)} onChange={onChange} />);
    expect(complete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Ask for an analysis from the source/ }));
    const [proposed] = onChange.mock.calls[0][0] as QuestionAnalysis[];
    expect(proposed).toMatchObject({ origin: "ai", status: "proposed", provider: "Test model", rule: "Venous entry, right-sided valve." });
  });

  it("says why when a model's reply is refused, and stores nothing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SourceTeaching question={siblings[1]} document={source} siblings={siblings} provider={provider(() => ({ correctKey: "A" }))} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Ask for an analysis from the source/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not asked for/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens the source page on request, and offers to attach the original when it is not on this device", async () => {
    const user = userEvent.setup();
    render(<SourceTeaching question={first} document={source} siblings={siblings} onChange={() => {}} />);
    const open = screen.getByRole("button", { name: "See the source, page 1" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    await user.click(open);
    expect(await screen.findByRole("button", { name: "Attach the original file" })).toBeTruthy();
    expect(screen.getByText(/The original file is not on this device/)).toBeTruthy();
    // The saved text of the page is there either way.
    expect(screen.getByText("Text of this page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 1" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Page 3" }));
    expect(screen.getByRole("button", { name: "Page 3" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("page 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide the source page" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("refuses a different file with a plain reason", async () => {
    const { SourceOriginalError } = await vi.importActual<typeof import("../../lib/decode")>("../../lib/decode");
    sources.save.mockRejectedValueOnce(new SourceOriginalError("different-file", "This is a different version of the file."));
    const user = userEvent.setup();
    render(<SourceTeaching question={first} document={source} siblings={siblings} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: "See the source, page 1" }));
    await screen.findByRole("button", { name: "Attach the original file" });
    await user.upload(screen.getByLabelText("Attach the original file of Cardiology review"), new File(["%PDF other"], "other.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This is a different version of the file.");
  });
});
