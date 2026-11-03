// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../../lib/extractText";
import { attachPdfFigures } from "../../lib/pdfFigures";
import { useStore } from "../../lib/store";
import { MAX_SOURCE_ORIGINAL_BYTES } from "../../lib/sourceOriginal";
import { MassImport, massImportFileStatus } from "./MassImport";

vi.mock("../../lib/checksum", () => ({ sha256Hex: vi.fn(async () => "sha256-test") }));
// The PDF bytes here are a stand-in, so the figure pass is stubbed like the text pass.
vi.mock("../../lib/pdfFigures", () => ({ attachPdfFigures: vi.fn(async () => ({ images: [], notes: [] })) }));
vi.mock("../../lib/extractText", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/extractText")>(),
  extractPdfText: vi.fn(),
}));

const original = {
  questions: useStore.getState().questions,
  questionSets: useStore.getState().questionSets,
  documents: useStore.getState().documents,
  courses: useStore.getState().courses,
};

// An empty library and no modules: nothing a file could repeat, and nowhere it has to be filed.
beforeEach(async () => {
  vi.clearAllMocks();
  await useStore.setState({ questions: [], questionSets: [], documents: [], courses: [] });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await useStore.setState(original);
});

async function processReadyText(onInspect = vi.fn()) {
  const user = userEvent.setup();
  render(<MassImport onInspect={onInspect} />);
  const contents = [
    "1. Which option is correct?",
    "A. Alpha",
    "B. Beta",
    "C. Gamma",
    "D. Delta",
    "Answer: B",
    "Explanation: Beta is the supported answer.",
  ].join("\n");
  const file = new File([contents], "mapped.txt", { type: "text/plain" });
  await user.upload(screen.getByLabelText("Choose multiple question files"), file);
  await user.click(screen.getByRole("button", { name: "Import files" }));
  await screen.findByText("ready to accept");
  return { user, file, onInspect };
}

describe("Mass Import trust handoff", () => {
  it("keeps supported files from a mixed selection and never reads rejected files", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<MassImport onInspect={vi.fn()} />);
    const supported = new File(["1. Which option is correct?\nA. Alpha\nB. Beta\nAnswer: B"], "questions.txt", { type: "text/plain" });
    const unsupported = new File(["video bytes"], "lecture.mp4", { type: "video/mp4" });
    const image = new File(["image bytes"], "figure.png", { type: "image/png" });
    const oversized = new File(["pdf bytes"], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: MAX_SOURCE_ORIGINAL_BYTES + 1 });
    const readUnsupported = vi.fn(async () => new ArrayBuffer(1));
    const readImage = vi.fn(async () => new ArrayBuffer(1));
    const readOversized = vi.fn(async () => new ArrayBuffer(1));
    Object.defineProperty(unsupported, "arrayBuffer", { value: readUnsupported });
    Object.defineProperty(image, "arrayBuffer", { value: readImage });
    Object.defineProperty(oversized, "arrayBuffer", { value: readOversized });

    await user.upload(screen.getByLabelText("Choose multiple question files"), [unsupported, image, supported, oversized]);
    expect(screen.getByRole("status").textContent).toContain("3 files were not added");
    expect(screen.getByText("lecture.mp4")).toBeTruthy();
    expect(screen.getByText("figure.png")).toBeTruthy();
    expect(screen.getByText("huge.pdf")).toBeTruthy();
    expect(screen.getAllByText(/Unsupported format/)).toHaveLength(2);
    expect(screen.getByText(/Larger than 128 MB/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove questions.txt" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove lecture.mp4" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove figure.png" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove huge.pdf" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Import files" }));
    await screen.findByRole("button", { name: "Edit questions.txt" });
    expect(readUnsupported).not.toHaveBeenCalled();
    expect(readImage).not.toHaveBeenCalled();
    expect(readOversized).not.toHaveBeenCalled();
  });

  it("rejects a supported extension with an incompatible media type", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<MassImport onInspect={vi.fn()} />);
    const disguised = new File(["video bytes"], "lecture.txt", { type: "video/mp4" });
    const readDisguised = vi.fn(async () => new ArrayBuffer(1));
    Object.defineProperty(disguised, "arrayBuffer", { value: readDisguised });
    await user.upload(screen.getByLabelText("Choose multiple question files"), disguised);
    expect(screen.getByRole("status").textContent).toContain("1 file was not added");
    expect(screen.getByText("lecture.txt")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Import files" }) as HTMLButtonElement).disabled).toBe(true);
    expect(readDisguised).not.toHaveBeenCalled();
  });

  it("queues a batch in natural reading order, whatever order the OS hands over (I3-26)", async () => {
    const user = userEvent.setup();
    render(<MassImport onInspect={vi.fn()} />);
    const files = ["NCRS Lecture 10.txt", "NCRS Lecture 2.txt", "Week 9 IMCQ 2.txt", "NCRS Lecture 1.txt", "Week 9 IMCQ 1.txt"]
      .map((name) => new File(["1. Q?\nA. a\nB. b\nAnswer: A"], name, { type: "text/plain" }));
    await user.upload(screen.getByLabelText("Choose multiple question files"), files);
    const names = [...document.querySelectorAll("*")]
      .map((element) => element.childNodes.length === 1 && element.textContent ? element.textContent : "")
      .filter((text) => /\.txt$/.test(text));
    const order = [...new Set(names)];
    expect(order).toEqual(["NCRS Lecture 1.txt", "NCRS Lecture 2.txt", "NCRS Lecture 10.txt", "Week 9 IMCQ 1.txt", "Week 9 IMCQ 2.txt"]);
  });

  it("never marks a high-confidence draft with no mapped answer ready", () => {
    expect(massImportFileStatus([{
      stem: "Unresolved despite a malformed confidence value",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
      correctKey: undefined,
      confidence: "high",
      warnings: [],
    }])).toBe("needs-review");
  });

  it("hands a file to the editor with every source field", async () => {
    const onInspect = vi.fn();
    const { user, file } = await processReadyText(onInspect);

    await user.click(screen.getByRole("button", { name: "Edit mapped.txt" }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({
      title: "mapped",
      fileName: "mapped.txt",
      fileType: "text",
      sizeBytes: file.size,
      rawText: expect.stringContaining("Which option is correct?"),
      pageTexts: undefined,
      checksum: "sha256-test",
      warnings: [],
      source: "imported",
      drafts: [expect.objectContaining({ correctKey: "B" })],
    }));
  });

  it("preserves PDF pages, warnings, and source identity for inspection", async () => {
    vi.mocked(extractPdfText).mockResolvedValue({
      text: [
        "1. Which PDF option is correct?", "A. Alpha", "B. Beta", "C. Gamma", "D. Delta",
        "Answer: B", "Explanation: Beta is the supported answer.",
      ].join("\n"),
      pages: ["Page one source text"],
      warnings: ["PDF extraction warning"],
      empty: false,
    });
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<MassImport onInspect={onInspect} />);
    const file = new File(["pdf bytes"], "mapped.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Choose multiple question files"), file);
    await user.click(screen.getByRole("button", { name: "Import files" }));
    await screen.findByText("ready to accept");
    await user.click(screen.getByRole("button", { name: "Edit mapped.pdf" }));

    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "mapped.pdf",
      fileType: "pdf",
      sizeBytes: file.size,
      pageTexts: ["Page one source text"],
      checksum: "sha256-test",
      warnings: ["PDF extraction warning"],
      source: "pdf",
    }));
  });

  it("carries a PDF's figures and why each was attached into the review", async () => {
    vi.mocked(extractPdfText).mockResolvedValue({
      text: ["1. Which PDF option is correct?", "A. Alpha", "B. Beta", "C. Gamma", "D. Delta", "Answer: B"].join("\n"),
      pages: ["1. Which PDF option is correct? A. Alpha B. Beta"],
      warnings: [],
      empty: false,
    });
    const figure = new File(["png"], "mapped-p1-fig1.png", { type: "image/png" });
    vi.mocked(attachPdfFigures).mockImplementationOnce(async (_buffer, _name, drafts) => {
      drafts[0].attachmentNames = [figure.name];
      return { images: [figure], notes: ["1 image found in this PDF, 1 attached to a question by its place on the page."] };
    });
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<MassImport onInspect={onInspect} />);
    await user.upload(screen.getByLabelText("Choose multiple question files"), new File(["pdf bytes"], "mapped.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Import files" }));
    await screen.findByText("ready to accept");
    // The queue says what came with the file before it is opened.
    expect(screen.getByText(/1 image$/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit mapped.pdf" }));

    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({
      images: [figure],
      warnings: ["1 image found in this PDF, 1 attached to a question by its place on the page."],
      drafts: [expect.objectContaining({ attachmentNames: ["mapped-p1-fig1.png"] })],
    }));
  });

  it("routes a needs-review file through the same inspection handoff", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<MassImport onInspect={onInspect} />);
    const file = new File([[
      "1. Which option is correct?",
      "A. Alpha",
      "B. Beta",
      "C. Gamma",
    ].join("\n")], "unmapped.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("Choose multiple question files"), file);
    await user.click(screen.getByRole("button", { name: "Import files" }));
    await screen.findByText("needs review");

    // A file with an unanswered question cannot be accepted as it is: only edited or skipped.
    expect(screen.queryByRole("button", { name: "Accept unmapped.txt" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept all valid/ })).toBeNull();
    expect(screen.getByText("1 question has no certain answer.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit unmapped.txt" }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "unmapped.txt",
      rawText: expect.stringContaining("Which option is correct?"),
      drafts: [expect.objectContaining({ correctKey: undefined })],
    }));
  });

  it("removes an invalid middle file without losing later work or keyboard focus", async () => {
    const user = userEvent.setup();
    render(<MassImport onInspect={vi.fn()} />);
    const valid = "1. Stable question?\nA. Alpha\nB. Beta\nAnswer: B";
    await user.upload(screen.getByLabelText("Choose multiple question files"), [
      new File([valid], "first.txt", { type: "text/plain" }),
      new File(["notes without a question"], "invalid.txt", { type: "text/plain" }),
      new File([valid], "third.txt", { type: "text/plain" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Import files" }));
    await screen.findByRole("button", { name: "Edit third.txt" });

    await user.click(screen.getByRole("button", { name: "Remove invalid.txt" }));
    expect(screen.queryByText("invalid.txt")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit first.txt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit third.txt" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove third.txt" }),
    ));
  });

  it("does not take focus from a field reached before a queue restore frame", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
    const user = userEvent.setup();
    render(<MassImport onInspect={vi.fn()} />);
    render(<input aria-label="Another field" />);
    await user.upload(screen.getByLabelText("Choose multiple question files"), [
      new File(["notes"], "first.txt", { type: "text/plain" }),
      new File(["notes"], "second.txt", { type: "text/plain" }),
    ]);

    await user.click(screen.getByRole("button", { name: "Remove first.txt" }));
    const field = screen.getByLabelText("Another field") as HTMLInputElement;
    field.focus();
    frames.splice(0).forEach((frame) => frame(0));
    await user.keyboard("two words");

    expect(field.value).toBe("two words");
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole("button", { name: "Remove second.txt" })).toBeTruthy();
  });

  it("keeps focus on a field reached while a review was saving", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
    const user = userEvent.setup();
    const onInspect = vi.fn();
    const view = render(<MassImport onInspect={onInspect} />);
    render(<input aria-label="Another field" />);
    const valid = "1. Stable question?\nA. Alpha\nB. Beta\nAnswer: B";
    await user.upload(screen.getByLabelText("Choose multiple question files"), [
      new File([valid], "first.txt", { type: "text/plain" }),
      new File([valid], "second.txt", { type: "text/plain" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Import files" }));
    await screen.findByRole("button", { name: "Edit second.txt" });
    await user.click(screen.getByRole("button", { name: "Edit first.txt" }));

    const field = screen.getByLabelText("Another field");
    field.focus();
    view.rerender(<MassImport onInspect={onInspect} finalizedQueueId={onInspect.mock.calls[0][0].batchQueueId} />);
    expect(screen.queryByRole("button", { name: "Edit first.txt" })).toBeNull();
    frames.splice(0).forEach((frame) => frame(0));

    expect(document.activeElement).toBe(field);
  });

  it("associates a separate numbered answer file and keeps it as provenance", async () => {
    const user = userEvent.setup();
    const onInspect = vi.fn();
    render(<MassImport onInspect={onInspect} />);
    await user.upload(screen.getByLabelText("Choose multiple question files"), [
      new File(["1. Which option is correct?\nA. Alpha\nB. Beta\nC. Gamma"], "questions.txt", { type: "text/plain" }),
      new File(["Answer key\n1. B"], "answers.txt", { type: "text/plain" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Import files" }));
    await screen.findByRole("button", { name: "Match answers.txt to questions" });
    await user.click(screen.getByRole("button", { name: "Match answers.txt to questions" }));
    expect(await screen.findByText("answers matched")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit questions.txt" }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({
      drafts: [expect.objectContaining({ correctKey: "B" })],
    }));
  });
});
