// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob } from "node:buffer";
import { setQuestionAttachmentAccount, type QuestionAttachmentScope } from "../../lib/questionAttachmentScope";
import { SourcePagePreview } from "./SourcePagePreview";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), draw: vi.fn(), destroy: vi.fn() }));
vi.mock("../../lib/decode", () => ({ readSourceOriginal: mocks.read, saveSourceOriginal: mocks.save }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ destroy: mocks.destroy, promise: Promise.resolve({ numPages: 1,
    getPage: async () => ({ getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve(mocks.draw()) }) }),
  }) }),
}));

const source = { id: "same-source", title: "Source page", checksum: "a".repeat(64), pageTexts: ["Source text"] };
beforeEach(() => {
  setQuestionAttachmentAccount("A");
  mocks.read.mockReset(); mocks.draw.mockReset(); mocks.destroy.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("source page account boundary", () => {
  it("hides a drawn page immediately when the account changes", async () => {
    mocks.read.mockImplementation(async (_id: string, _hash: string, options: { scope: QuestionAttachmentScope }) =>
      options.scope.accountId === "A" ? new NativeBlob(["synthetic source"]) : undefined);
    render(<SourcePagePreview document={source} page={1} />);
    await screen.findByRole("img", { name: "Source page, page 1" });
    act(() => setQuestionAttachmentAccount("B"));
    expect(screen.queryByRole("img", { name: "Source page, page 1" })).toBeNull();
    await screen.findByRole("button", { name: "Attach the original file" });
    expect(mocks.draw).toHaveBeenCalledTimes(1);
  });

  it("does not draw a late A read after switching to B", async () => {
    let finish!: (value: NativeBlob) => void;
    mocks.read.mockImplementationOnce(() => new Promise<NativeBlob>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    render(<SourcePagePreview document={source} page={1} />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    act(() => setQuestionAttachmentAccount("B"));
    await act(async () => { finish(new NativeBlob(["private original"])); });
    expect(screen.queryByRole("img", { name: "Source page, page 1" })).toBeNull();
    expect(mocks.draw).not.toHaveBeenCalled();
  });
});
