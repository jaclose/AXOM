// @vitest-environment jsdom
// R27: synthetic account A/B media with an intentionally identical attachment tuple.
// A passed code suite is not authenticated live account acceptance.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useAccount } from "../../lib/account/accountStore";
import type { QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionExhibits } from "./QuestionExhibits";

const { readBlob } = vi.hoisted(() => ({ readBlob: vi.fn() }));
vi.mock("../../lib/questionAttachments", () => ({ getQuestionAttachmentBlob: readBlob }));
vi.mock("../../lib/account/accountStore", async () => {
  const { create } = await import("zustand");
  // React subscriptions must be real: changing auth identity should rerender
  // the still-mounted exhibit, rather than remounting it as a false positive.
  return { useAccount: create(() => ({ phase: "signed-in", user: {
    id: "synthetic-account-A", email: "", displayName: "", emailConfirmed: true,
  } })) };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const sameTuple: QuestionImageAttachment = {
  id: "same-synthetic-attachment",
  blobKey: "same-synthetic-blob-key",
  updatedAt: "2026-11-08T00:00:00.000Z",
  createdAt: "2026-11-08T00:00:00.000Z",
  fileName: "synthetic.png",
  mimeType: "image/png",
  byteSize: 24,
  width: 100,
  height: 100,
  altText: "Same tuple image",
  role: "exhibit",
};

afterEach(() => {
  cleanup();
  readBlob.mockReset();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  useAccount.setState({ phase: "signed-in", user: {
    id: "synthetic-account-A", email: "", displayName: "", emailConfirmed: true,
  } });
});

test("mounted A→B with identical metadata tuple invalidates A's URL, open lightbox, and pending B read", async () => {
  const blobA = new Blob(["synthetic bytes owned by A"], { type: "image/png" });
  const blobB = new Blob(["different synthetic bytes owned by B"], { type: "image/png" });
  const pendingB = deferred<{ blob: Blob }>();
  const created = vi.fn((blob: Blob) => blob === blobA ? "blob:synthetic-A"
    : blob === blobB ? "blob:synthetic-B" : "blob:unexpected");
  const revoked = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: created });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoked });
  readBlob.mockImplementation((key: string) => {
    if (key !== sameTuple.blobKey) throw new Error("Unexpected synthetic blob key");
    return useAccount.getState().user?.id === "synthetic-account-A"
      ? Promise.resolve({ blob: blobA })
      : pendingB.promise;
  });

  // Deliberately retain the SAME React component, attachment object, id,
  // blobKey and updatedAt across the account handoff.
  const view = render(<QuestionExhibits attachments={[sameTuple]} />);
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "Same tuple image" }).getAttribute("src")).toBe("blob:synthetic-A");
  });
  fireEvent.click(screen.getByRole("button", { name: "Enlarge Same tuple image" }));
  expect(screen.getByRole("dialog", { name: "Same tuple image" })).toBeTruthy();

  await act(async () => {
    useAccount.setState({ phase: "signed-in", user: {
      id: "synthetic-account-B", email: "", displayName: "", emailConfirmed: true,
    } });
  });
  view.rerender(<QuestionExhibits attachments={[sameTuple]} />);

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(view.container.querySelector('img[src="blob:synthetic-A"]')).toBeNull();
  expect((screen.getByRole("button", { name: "Enlarge Same tuple image" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(revoked).toHaveBeenCalledWith("blob:synthetic-A"));
  await waitFor(() => expect(readBlob).toHaveBeenCalledTimes(2));

  await act(async () => {
    pendingB.resolve({ blob: blobB });
    await pendingB.promise;
  });
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "Same tuple image" }).getAttribute("src")).toBe("blob:synthetic-B");
  });
  expect(created.mock.calls.map(([blob]) => blob)).toEqual([blobA, blobB]);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.unmount();
  expect(revoked).toHaveBeenCalledWith("blob:synthetic-B");
  expect(revoked).toHaveBeenCalledTimes(2);
});
