// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionExhibits } from "./QuestionExhibits";

vi.mock("../../lib/questionAttachments", () => ({
  getQuestionAttachmentBlob: vi.fn().mockResolvedValue({
    blob: new Blob(["synthetic ECG pixels"], { type: "image/png" }),
    mimeType: "image/png", byteSize: 20, questionId: "synthetic-q",
    updatedAt: "2026-11-08T00:00:00.000Z",
  }),
}));

const exhibit: QuestionImageAttachment = {
  id: "synthetic-exhibit", fileName: "synthetic-ecg.png", mimeType: "image/png",
  byteSize: 20, width: 100, height: 80, altText: "ECG tracing",
  createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
  blobKey: "synthetic-blob", role: "exhibit",
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

test("an enlarged question exhibit traps Tab/Shift+Tab and restores its opener on Escape", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:axom-synthetic") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

  render(<>
    <button type="button">Previous answer</button>
    <QuestionExhibits attachments={[exhibit]} />
    <button type="button">Next answer</button>
  </>);

  const open = await screen.findByRole("button", { name: "Enlarge ECG tracing" });
  await waitFor(() => expect(open.hasAttribute("disabled")).toBe(false));
  fireEvent.click(open);

  const dialog = await screen.findByRole("dialog", { name: "ECG tracing" });
  const close = within(dialog).getByRole("button", { name: "Close image" });
  await waitFor(() => expect(document.activeElement).toBe(close));

  // A modal with a single focusable control must prevent browser Tab navigation
  // into the underlying question/answer controls in either direction.
  for (const shiftKey of [false, true]) {
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, shiftKey });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  }

  fireEvent.keyDown(document, { key: "Escape", bubbles: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(open);

  // Do not intercept ordinary page keyboard navigation after the modal closes.
  const outsideTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  document.dispatchEvent(outsideTab);
  expect(outsideTab.defaultPrevented).toBe(false);
});
