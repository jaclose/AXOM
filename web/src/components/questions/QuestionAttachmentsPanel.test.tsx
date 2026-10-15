// @vitest-environment jsdom
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionAttachmentsPanel } from "./QuestionAttachmentsPanel";
import { DB_NAME } from "../../lib/localVault";
import {
  getQuestionAttachmentBlob,
  listQuestionAttachmentBlobKeys,
  putQuestionAttachmentBlob,
  type QuestionImageAttachment,
} from "../../lib/questionAttachments";

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const pngFile = (name = "figure.png") => new File([PNG_BYTES.buffer as ArrayBuffer], name, { type: "image/png" });

beforeEach(async () => {
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  // jsdom has no object URLs; the component must tolerate a stubbed pair.
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:stub"),
    revokeObjectURL: vi.fn(),
  }));
  await deleteDatabase(DB_NAME);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function metadata(overrides: Partial<QuestionImageAttachment> = {}): QuestionImageAttachment {
  return {
    id: "attachment-a", fileName: "slide.png", mimeType: "image/png", byteSize: 2048,
    altText: "", createdAt: "2026-07-17T10:00:00.000Z", updatedAt: "2026-07-17T10:00:00.000Z",
    blobKey: overrides.id ?? "attachment-a", ...overrides,
  };
}

describe("QuestionAttachmentsPanel", () => {
  it("uploads via the picker, persists the blob, and reports success politely", async () => {
    const changes: QuestionImageAttachment[][] = [];
    render(<QuestionAttachmentsPanel questionId="q1" attachments={[]} onChange={(next) => changes.push(next)} />);
    const input = screen.getByLabelText("Attach images to this question");
    fireEvent.change(input, { target: { files: [pngFile()] } });
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0][0]).toMatchObject({ mimeType: "image/png", fileName: "figure.png", altText: "" });
    expect(await listQuestionAttachmentBlobKeys()).toEqual([changes[0][0].blobKey]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("1 image attached."));
  });

  it("rejects an unsupported type with a specific message and stores nothing", async () => {
    const onChange = vi.fn();
    render(<QuestionAttachmentsPanel questionId="q1" attachments={[]} onChange={onChange} />);
    const bad = new File(["<svg/>"], "vector.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByLabelText("Attach images to this question"), { target: { files: [bad] } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("PNG, JPEG, WebP, and GIF"));
    expect(onChange).not.toHaveBeenCalled();
    expect(await listQuestionAttachmentBlobKeys()).toEqual([]);
  });

  it("one failing file never discards the successful ones (order preserved)", async () => {
    const changes: QuestionImageAttachment[][] = [];
    render(<QuestionAttachmentsPanel questionId="q1" attachments={[]} onChange={(next) => changes.push(next)} />);
    const bad = new File(["nope"], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Attach images to this question"), {
      target: { files: [pngFile("one.png"), bad, pngFile("two.png")] },
    });
    await waitFor(() => expect(changes.length).toBe(2));
    expect(changes[1].map((a) => a.fileName)).toEqual(["one.png", "two.png"]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("2 images attached."));
    expect(screen.getByRole("status").textContent).toContain("PNG, JPEG, WebP, and GIF");
  });

  it("renders thumbnails with alt text, supports description editing", async () => {
    const attachment = metadata({ altText: "" });
    const onChange = vi.fn();
    render(<QuestionAttachmentsPanel questionId="q1" attachments={[attachment]} onChange={onChange} />);
    const alt = screen.getByLabelText("Description for slide.png") as HTMLInputElement;
    expect(alt.placeholder).toBe("Description not added");
    fireEvent.change(alt, { target: { value: "Renal histology slide" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "attachment-a", altText: "Renal histology slide" }),
    ]);
  });

  it("removes an attachment (metadata + blob) and identifies the file", async () => {
    const attachment = metadata();
    await putQuestionAttachmentBlob(attachment.blobKey, {
      blob: new Blob([PNG_BYTES], { type: "image/png" }),
      mimeType: "image/png",
      byteSize: PNG_BYTES.byteLength,
      questionId: "q1",
      updatedAt: attachment.updatedAt,
    });
    const changes: QuestionImageAttachment[][] = [];
    render(<QuestionAttachmentsPanel questionId="q1" attachments={[attachment]} onChange={(next) => changes.push(next)} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove slide.png" }));
    await waitFor(() => expect(changes).toEqual([[]]));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain('Removed "slide.png"'));
    expect(await listQuestionAttachmentBlobKeys()).toEqual([]);
  });

  it("removes canonical private-library metadata without deleting shared bytes", async () => {
    const blobKey = `private-library:sha256:${"a".repeat(64)}`;
    const attachment = metadata({ id: "canonical-a", blobKey });
    await putQuestionAttachmentBlob(blobKey, {
      blob: new Blob([PNG_BYTES], { type: "image/png" }),
      mimeType: "image/png",
      byteSize: PNG_BYTES.byteLength,
      questionId: "private-library",
      updatedAt: attachment.updatedAt,
    });
    const changes: QuestionImageAttachment[][] = [];
    render(<QuestionAttachmentsPanel questionId="q1" attachments={[attachment]} onChange={(next) => changes.push(next)} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove slide.png" }));

    await waitFor(() => expect(changes).toEqual([[]]));
    expect((await getQuestionAttachmentBlob(blobKey, { localOnly: true }))?.byteSize).toBe(PNG_BYTES.byteLength);
  });

  it("normal text paste is never intercepted", () => {
    const onChange = vi.fn();
    const { container } = render(<QuestionAttachmentsPanel questionId="q1" attachments={[]} onChange={onChange} />);
    const root = container.querySelector(".question-attachments")!;
    const event = fireEvent.paste(root, { clipboardData: { items: [] } });
    expect(event).toBe(true); // not preventDefault-ed → default text paste proceeds
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a safe missing state when the blob is unavailable", async () => {
    const attachment = metadata({ id: "attachment-lost" });
    render(<QuestionAttachmentsPanel questionId="q1" attachments={[attachment]} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("img", { name: /is unavailable/ })).toBeTruthy());
  });
});
