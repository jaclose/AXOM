// @vitest-environment jsdom
// R52 release integration: accessible labels must follow current exhibit metadata.
// Synthetic image bytes only. A failing fixture does not establish a live incident.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getQuestionAttachmentBlob, type QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionExhibits } from "./QuestionExhibits";

vi.mock("./useQuestionAttachmentScope", () => ({
  useQuestionAttachmentScope: () => ({ owner: "synthetic-owner-A", generation: 1 }),
}));
vi.mock("../../lib/questionAttachments", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/questionAttachments")>(),
  getQuestionAttachmentBlob: vi.fn(),
}));

const timestamp = "2026-11-11T00:00:00.000Z";
function exhibit(altText: string, blobKey = "synthetic-ecg-v1"): QuestionImageAttachment {
  return {
    id: "synthetic-ecg", blobKey, altText, fileName: "synthetic-ecg.png",
    mimeType: "image/png", byteSize: 3, width: 500, height: 240,
    createdAt: timestamp, updatedAt: timestamp, role: "exhibit",
  };
}

let allocate: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(getQuestionAttachmentBlob).mockReset();
  vi.mocked(getQuestionAttachmentBlob).mockResolvedValue({
    blob: new Blob(["PNG"], { type: "image/png" }),
    mimeType: "image/png", byteSize: 3, questionId: "synthetic-question",
    updatedAt: timestamp,
  });
  allocate = vi.fn().mockImplementation(() => `blob:r52-${allocate.mock.calls.length}`);
  revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: allocate });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

async function openExhibit(label: string) {
  const opener = screen.getByRole("button", { name: `Enlarge ${label}` });
  await waitFor(() => expect(within(opener).getByRole("img", { name: label }).getAttribute("src")).toMatch(/^blob:r52-/));
  fireEvent.click(opener);
  return screen.getByRole("dialog", { name: label });
}

test("an open exhibit dialog uses the latest reviewed accessible description without reallocating unchanged bytes", async () => {
  const view = render(<QuestionExhibits attachments={[exhibit("Initial ECG description")]} />);
  const dialog = await openExhibit("Initial ECG description");
  const initialSrc = within(dialog).getByRole("img", { name: "Initial ECG description" }).getAttribute("src");

  // A metadata-only revision can arrive from an import/sync without changing
  // the blob key or timestamp. Inline alt updates; a stored modal snapshot must not.
  view.rerender(<QuestionExhibits attachments={[exhibit("Reviewed ECG: inferior ST elevation")]} />);
  expect(screen.getByRole("button", { name: "Enlarge Reviewed ECG: inferior ST elevation" })).toBeTruthy();
  const updatedDialog = screen.getByRole("dialog", { name: "Reviewed ECG: inferior ST elevation" });
  expect(updatedDialog).toBe(dialog);
  expect(within(updatedDialog).getByRole("img", { name: "Reviewed ECG: inferior ST elevation" }).getAttribute("src"))
    .toBe(initialSrc);
  expect(allocate).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
});

test("removing an exhibit description updates the still-open modal to its accessible fallback", async () => {
  const view = render(<QuestionExhibits attachments={[exhibit("Original clinical diagram description")]} />);
  const dialog = await openExhibit("Original clinical diagram description");
  view.rerender(<QuestionExhibits attachments={[exhibit("")]} />);

  expect(screen.getByRole("button", { name: "Enlarge Question image" })).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Question image" })).toBe(dialog);
  expect(within(dialog).getByRole("img", { name: "Question image" })).toBeTruthy();
  expect(allocate).toHaveBeenCalledTimes(1);
});

test("a real blob-key revision still invalidates the previous exhibit and dismisses its dialog", async () => {
  const view = render(<QuestionExhibits attachments={[exhibit("Clinical figure", "synthetic-ecg-v1")]} />);
  await openExhibit("Clinical figure");

  view.rerender(<QuestionExhibits attachments={[exhibit("Clinical figure", "synthetic-ecg-v2")]} />);
  expect(screen.queryByRole("dialog", { name: "Clinical figure" })).toBeNull();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:r52-1"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Enlarge Clinical figure" })
    .querySelector("img")?.getAttribute("src")).toBe("blob:r52-2"));
  expect(allocate).toHaveBeenCalledTimes(2);
});
