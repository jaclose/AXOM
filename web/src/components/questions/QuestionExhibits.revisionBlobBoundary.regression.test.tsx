// @vitest-environment jsdom
// R25: synthetic revision replacement; no learner media, identities or private content.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionExhibits } from "./QuestionExhibits";

const { getBlob } = vi.hoisted(() => ({ getBlob: vi.fn() }));
vi.mock("../../lib/questionAttachments", () => ({ getQuestionAttachmentBlob: getBlob }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  getBlob.mockReset();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

test("new attachment revision under the same ID/blobKey cannot show or zoom the old object URL", async () => {
  const originalBlob = new Blob(["synthetic revision one"], { type: "image/png" });
  const revisedBlob = new Blob(["synthetic revision two"], { type: "image/png" });
  const pendingRevision = deferred<{ blob: Blob }>();
  const create = vi.fn((blob: Blob) =>
    blob === originalBlob ? "blob:revision-one" : blob === revisedBlob ? "blob:revision-two" : "blob:unexpected");
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  getBlob.mockImplementation(() =>
    getBlob.mock.calls.length === 1 ? Promise.resolve({ blob: originalBlob }) : pendingRevision.promise);

  const oldAttachment: QuestionImageAttachment = {
    id: "same-attachment", blobKey: "same-durable-key", fileName: "synthetic.png",
    mimeType: "image/png", byteSize: 22, width: 100, height: 80,
    altText: "Original revision", role: "exhibit",
    createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
  };
  const nextAttachment: QuestionImageAttachment = {
    ...oldAttachment, altText: "Revised revision", updatedAt: "2026-11-08T00:01:00.000Z",
  };

  const view = render(<QuestionExhibits attachments={[oldAttachment]} />);
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "Original revision" }).getAttribute("src")).toBe("blob:revision-one"));
  fireEvent.click(screen.getByRole("button", { name: "Enlarge Original revision" }));
  expect(screen.getByRole("dialog", { name: "Original revision" })).toBeTruthy();

  // Metadata revision changed, while the durable store key did not. Old URL
  // and old zoom must disappear until the new bytes have been read.
  view.rerender(<QuestionExhibits attachments={[nextAttachment]} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("img", { name: "Revised revision" })).toBeNull();
  expect(view.container.querySelector('img[src="blob:revision-one"]')).toBeNull();
  await waitFor(() => expect(getBlob).toHaveBeenCalledTimes(2));

  await act(async () => {
    pendingRevision.resolve({ blob: revisedBlob });
    await pendingRevision.promise;
  });
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "Revised revision" }).getAttribute("src")).toBe("blob:revision-two"));
  expect(create.mock.calls.map(([blob]) => blob)).toEqual([originalBlob, revisedBlob]);
  expect(revoke).toHaveBeenCalledWith("blob:revision-one");
  expect(screen.queryByRole("dialog")).toBeNull();
});
