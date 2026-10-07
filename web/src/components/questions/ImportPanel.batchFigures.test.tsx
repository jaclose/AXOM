// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../../lib/extractText";
import { parseQuestionBlocks } from "../../lib/questionParse";
import { attachPdfFigures } from "../../lib/pdfFigures";
import { useStore } from "../../lib/store";
import { ImportPanel } from "./ImportPanel";

// A PDF's figures are cut out while the queue reads the file. Opening that
// file for review has to bring them along: a figure left behind in the queue
// is a figure silently dropped.

vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("../../lib/checksum", () => ({ sha256Hex: vi.fn(async () => "sha256-batch-figure") }));
vi.mock("../../lib/pdfFigures", () => ({ attachPdfFigures: vi.fn(async () => ({ images: [], notes: [] })) }));
vi.mock("../../lib/extractText", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/extractText")>(),
  extractPdfText: vi.fn(),
}));
vi.mock("../../lib/ai", () => ({
  checkProviderHealth: vi.fn(async () => ({ ok: false, detail: "No provider" })),
  cleanExplanation: vi.fn(),
  enhanceQuestionSet: vi.fn(),
  generateQuestionDrafts: vi.fn(),
  loadAiSettings: vi.fn(() => ({ mode: "demo" })),
  mapAnswerFromText: vi.fn(),
  resolveActiveProvider: vi.fn(() => null),
}));

const original = {
  questions: useStore.getState().questions,
  questionSets: useStore.getState().questionSets,
  documents: useStore.getState().documents,
  courses: useStore.getState().courses,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await useStore.setState({ questions: [], questionSets: [], documents: [], courses: [] });
});
afterEach(async () => {
  cleanup();
  await useStore.setState(original);
});

describe("Import several files: figures", () => {
  it("brings a file's figures into the review when it is opened from the queue", async () => {
    vi.mocked(extractPdfText).mockResolvedValue({
      text: ["1. A tracing is shown. Which rhythm is present?", "A. Rhythm one", "B. Rhythm two", "C. Rhythm three", "Answer: C", "Explanation: The third rhythm matches the tracing."].join("\n"),
      pages: ["1. A tracing is shown. Which rhythm is present? A. Rhythm one B. Rhythm two C. Rhythm three"],
      warnings: [],
      empty: false,
    });
    const figure = new File(["png"], "tracing-p1-fig1.png", { type: "image/png" });
    vi.mocked(attachPdfFigures).mockImplementationOnce(async (_buffer, _name, drafts) => {
      drafts[0].attachmentNames = [figure.name];
      return { images: [figure], notes: ["1 image found in this PDF, 1 attached to a question by its place on the page."] };
    });

    const user = userEvent.setup();
    render(<ImportPanel initialTab="batch" />);
    await user.upload(screen.getByLabelText("Choose multiple question files"), new File(["pdf bytes"], "tracing.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Import files" }));
    await user.click(await screen.findByRole("button", { name: "Edit tracing.pdf" }));

    expect(await screen.findByText(/Review 1 parsed question/)).toBeTruthy();
    // The figure is in the review's image list, matched to the question that names it.
    const named = within(screen.getByRole("region", { name: "Images" })).getByRole("list", { name: "Named images" });
    expect(within(named).getByRole("listitem").textContent).toContain("tracing-p1-fig1.png");
    expect(within(named).getByRole("listitem").textContent).toContain("ready");
    const draft = screen.getByRole("group", { name: /A tracing is shown/ });
    expect(draft.textContent).toContain("image tracing-p1-fig1.png");
    expect(draft.textContent).not.toContain("not added yet");
  });
});

describe("Review: an image the import could not place", () => {
  const rawText = [
    "1. A tracing is shown. Which rhythm is present?", "A. Rhythm one", "B. Rhythm two", "C. Rhythm three", "Answer: C", "",
    "2. A film is shown. Which bone is broken?", "A. Radius", "B. Ulna", "C. Scaphoid", "Answer: C",
  ].join("\n");
  const tracing = new File(["png"], "deck-p2-fig1.png", { type: "image/png" });
  const film = new File(["png"], "deck-p3-fig1.png", { type: "image/png" });
  const seed = () => {
    const drafts = parseQuestionBlocks(rawText);
    drafts[0].attachmentNames = [tracing.name];
    return { drafts, rawText, title: "Deck", fileName: "deck.pdf", fileType: "pdf", checksum: "deck-checksum", images: [tracing, film] };
  };

  it("is listed, says it will be left out, and goes on the question the learner picks", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={seed()} />);
    const images = screen.getByRole("region", { name: "Images" });
    const unplaced = () => within(images).queryByRole("list", { name: "Images not on a question" });
    expect(within(unplaced()!).getByRole("listitem").textContent).toContain("deck-p3-fig1.png");
    expect(screen.getByText("The reviewed import is ready to finalize. 1 image is not on any question and will be left out.")).toBeTruthy();

    await user.selectOptions(within(images).getByLabelText("Attach deck-p3-fig1.png to a question"), "Question 2");
    expect(unplaced()).toBeNull();
    expect(within(images).getByRole("list", { name: "Named images" }).textContent).toContain("deck-p3-fig1.png");
    expect(screen.getByRole("group", { name: /A film is shown/ }).textContent).toContain("image deck-p3-fig1.png");
    expect(screen.getByText("The reviewed import is ready to finalize.")).toBeTruthy();
  });

  it("can be taken off a question it was put on by mistake", async () => {
    const user = userEvent.setup();
    render(<ImportPanel seed={seed()} />);
    const images = screen.getByRole("region", { name: "Images" });
    expect(screen.getByRole("group", { name: /A tracing is shown/ }).textContent).toContain("image deck-p2-fig1.png");

    await user.click(within(images).getByRole("button", { name: "Take deck-p2-fig1.png off its question" }));
    expect(screen.getByRole("group", { name: /A tracing is shown/ }).textContent).not.toContain("image deck-p2-fig1.png");
    expect(within(images).getByRole("list", { name: "Images not on a question" }).textContent).toContain("deck-p2-fig1.png");
    expect(screen.getByText("The reviewed import is ready to finalize. 2 images are not on any question and will be left out.")).toBeTruthy();
  });
});

