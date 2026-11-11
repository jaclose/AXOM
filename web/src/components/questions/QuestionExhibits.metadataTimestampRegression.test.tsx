// @vitest-environment jsdom
// R53: the attachment description editor advances metadata.updatedAt, without
// rewriting its immutable blobKey or its stored image bytes. Test this actual
// input shape, not only the constant-timestamp fixture covered by R52 (#470).
// All media, identities, and metadata below are synthetic.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getQuestionAttachmentBlob, type QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionExhibits } from "./QuestionExhibits";

vi.mock("./useQuestionAttachmentScope", () => ({
  useQuestionAttachmentScope: () => ({ owner: "synthetic-R53-account-A", generation: 1 }),
}));
vi.mock("../../lib/questionAttachments", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/questionAttachments")>(),
  getQuestionAttachmentBlob: vi.fn(),
}));

const BEFORE = "2026-11-11T20:00:00.000Z";
const AFTER = "2026-11-11T20:01:00.000Z";
const makeExhibit = (altText: string, updatedAt = BEFORE, blobKey = "synthetic-r53-same-bytes"): QuestionImageAttachment => ({
  id: "synthetic-r53-ecg",
  fileName: "synthetic-r53-ecg.png",
  mimeType: "image/png",
  byteSize: 3,
  width: 420,
  height: 240,
  role: "exhibit",
  altText,
  createdAt: BEFORE,
  updatedAt,
  blobKey,
});

let allocate: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(getQuestionAttachmentBlob).mockReset();
  // The stored blob record stays at BEFORE, proving this is an editor-style
  // metadata-only update and not a rehydrated or replaced binary.
  vi.mocked(getQuestionAttachmentBlob).mockResolvedValue({
    blob: new Blob(["PNG"], { type: "image/png" }),
    mimeType: "image/png",
    byteSize: 3,
    questionId: "synthetic-r53-question",
    updatedAt: BEFORE,
  });
  allocate = vi.fn().mockImplementation(() => `blob:r53-${allocate.mock.calls.length}`);
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
  const button = screen.getByRole("button", { name: `Enlarge ${label}` });
  await waitFor(() =>
    expect(within(button).getByRole("img", { name: label }).getAttribute("src")).toMatch(/^blob:r53-/),
  );
  fireEvent.click(button);
  return screen.getByRole("dialog", { name: label });
}

test("an editor-style alt-text revision advances updatedAt without dismissing the accessible viewer or reloading unchanged bytes", async () => {
  const first = makeExhibit("Initial synthetic ECG description");
  const next = makeExhibit("Reviewed synthetic ECG description", AFTER);
  expect(next.updatedAt).not.toBe(first.updatedAt);
  expect(next.blobKey).toBe(first.blobKey);

  const view = render(<QuestionExhibits attachments={[first]} />);
  const dialog = await openExhibit(first.altText);
  const firstSrc = within(dialog).getByRole("img", { name: first.altText }).getAttribute("src");
  expect(allocate).toHaveBeenCalledTimes(1);

  // QuestionAttachmentsPanel.updateAltText() does exactly this: changes altText
  // and updatedAt, without updating blobKey or calling the binary storage writer.
  view.rerender(<QuestionExhibits attachments={[next]} />);
  expect(screen.getByRole("button", { name: `Enlarge ${next.altText}` })).toBeTruthy();

  const current = screen.getByRole("dialog", { name: next.altText });
  expect(current).toBe(dialog);
  expect(within(current).getByRole("img", { name: next.altText }).getAttribute("src")).toBe(firstSrc);
  expect(allocate).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
});

test("a changed immutable blob key still dismisses the viewer and revokes the old URL", async () => {
  const view = render(<QuestionExhibits attachments={[makeExhibit("Synthetic diagram")]} />);
  await openExhibit("Synthetic diagram");

  view.rerender(<QuestionExhibits attachments={[makeExhibit("Synthetic diagram", AFTER, "synthetic-r53-new-binary")]} />);
  expect(screen.queryByRole("dialog", { name: "Synthetic diagram" })).toBeNull();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:r53-1"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Enlarge Synthetic diagram" })
    .querySelector("img")?.getAttribute("src")).toBe("blob:r53-2"));
  expect(allocate).toHaveBeenCalledTimes(2);
});
