// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "../../lib/extractText";
import { MassImport, massImportFileStatus } from "./MassImport";

vi.mock("../../lib/checksum", () => ({ sha256Hex: vi.fn(async () => "sha256-test") }));
vi.mock("../../lib/extractText", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/extractText")>(),
  extractPdfText: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

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
  await screen.findByText("ready to inspect");
  return { user, file, onInspect };
}

describe("Mass Import trust handoff", () => {
  it("never marks a high-confidence draft with no mapped answer ready", () => {
    expect(massImportFileStatus([{
      stem: "Unresolved despite a malformed confidence value",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }, { key: "C", text: "Gamma" }],
      correctKey: undefined,
      confidence: "high",
      warnings: [],
    }])).toBe("needs-review");
  });

  it("requires a ready file to hand off with every source field instead of persisting directly", async () => {
    const onInspect = vi.fn();
    const { user, file } = await processReadyText(onInspect);

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByText(/batch-save/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Inspect mapped.txt" }));
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
    await screen.findByText("ready to inspect");
    await user.click(screen.getByRole("button", { name: "Inspect mapped.pdf" }));

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

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Inspect unmapped.txt" }));
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
    await screen.findByRole("button", { name: "Inspect third.txt" });

    await user.click(screen.getByRole("button", { name: "Remove invalid.txt" }));
    expect(screen.queryByText("invalid.txt")).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect first.txt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inspect third.txt" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove third.txt" }),
    ));
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
    await user.click(screen.getByRole("button", { name: "Inspect questions.txt" }));
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({
      drafts: [expect.objectContaining({ correctKey: "B" })],
    }));
  });
});
