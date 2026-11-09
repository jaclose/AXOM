// @vitest-environment jsdom
// R22: synthetic A/B exhibit identities. No learner records or private images.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionExhibits } from "./QuestionExhibits";

const { loadBlob } = vi.hoisted(() => ({ loadBlob: vi.fn() }));
vi.mock("../../lib/questionAttachments", () => ({ getQuestionAttachmentBlob: loadBlob }));

const common = {
  id: "synthetic-shared-attachment-id",
  fileName: "synthetic-exhibit.png",
  mimeType: "image/png",
  byteSize: 16,
  width: 100,
  height: 80,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
  role: "exhibit",
} as const;

const accountA: QuestionImageAttachment = { ...common, altText: "A synthetic tracing", blobKey: "synthetic:A" };
const accountB: QuestionImageAttachment = { ...common, altText: "B synthetic tracing", blobKey: "synthetic:B" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function installSyntheticBlobs() {
  const a = new Blob(["A synthetic pixels"], { type: "image/png" });
  const b = new Blob(["B synthetic pixels"], { type: "image/png" });
  const waitingB = deferred<{ blob: Blob }>();
  loadBlob.mockImplementation((key: string) => {
    if (key === "synthetic:A") return Promise.resolve({ blob: a });
    if (key === "synthetic:B") return waitingB.promise;
    throw new Error("Unexpected test blob key: " + key);
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => blob === a ? "blob:synthetic-account-A" : blob === b ? "blob:synthetic-account-B" : "blob:unexpected"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  return { resolveB: () => waitingB.resolve({ blob: b }) };
}

afterEach(() => {
  cleanup();
  loadBlob.mockReset();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

test("same attachment ID with a new blobKey never displays A's object URL while B is loading", async () => {
  const { resolveB } = installSyntheticBlobs();
  const view = render(<QuestionExhibits attachments={[accountA]} />);
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "A synthetic tracing" }).getAttribute("src")).toBe("blob:synthetic-account-A");
  });

  // A→B may retain a stable imported question/attachment ID, but not its source bytes.
  view.rerender(<QuestionExhibits attachments={[accountB]} />);
  expect(screen.queryByRole("img", { name: "B synthetic tracing" })).toBeNull();
  expect(view.container.querySelector('img[src="blob:synthetic-account-A"]')).toBeNull();
  const pendingBButton = screen.getByRole("button", { name: "Enlarge B synthetic tracing" }) as HTMLButtonElement;
  expect(pendingBButton.disabled).toBe(true);

  resolveB();
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "B synthetic tracing" }).getAttribute("src")).toBe("blob:synthetic-account-B");
  });
  expect(view.container.querySelector('img[src="blob:synthetic-account-A"]')).toBeNull();
});

test("switching A→B while A lightbox is open removes A image and releases the page keyboard", async () => {
  const { resolveB } = installSyntheticBlobs();
  const view = render(<QuestionExhibits attachments={[accountA]} />);
  const openA = screen.getByRole("button", { name: "Enlarge A synthetic tracing" });
  await waitFor(() => expect((openA as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(openA);
  expect(screen.getByRole("dialog", { name: "A synthetic tracing" })).toBeTruthy();

  view.rerender(<QuestionExhibits attachments={[accountB]} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(view.container.querySelector('img[src="blob:synthetic-account-A"]')).toBeNull();
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  document.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);

  resolveB();
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "B synthetic tracing" }).getAttribute("src")).toBe("blob:synthetic-account-B");
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});


test("ambiguous delimiter characters cannot preserve an old attachment signature", async () => {
  // Legacy id:blobKey|id:blobKey strings collide for these two distinct arrays.
  const old = [
    { ...common, id: "shared", blobKey: "A|next:other", altText: "A first" },
    { ...common, id: "tail", blobKey: "T", altText: "A tail" },
  ] as QuestionImageAttachment[];
  const newer = [
    { ...common, id: "shared", blobKey: "A", altText: "B first" },
    { ...common, id: "next", blobKey: "other|tail:T", altText: "B second" },
  ] as QuestionImageAttachment[];
  const a = new Blob(["A synthetic"], { type: "image/png" });
  const tail = new Blob(["old tail synthetic"], { type: "image/png" });
  const b = new Blob(["B synthetic"], { type: "image/png" });
  const other = new Blob(["new tail synthetic"], { type: "image/png" });
  const pendingB = deferred<{ blob: Blob }>();
  const blobByKey = new Map<string, Promise<{ blob: Blob }>>([
    ["A|next:other", Promise.resolve({ blob: a })],
    ["T", Promise.resolve({ blob: tail })],
    ["A", pendingB.promise],
    ["other|tail:T", Promise.resolve({ blob: other })],
  ]);
  const blobUrl = new Map([[a, "blob:old-delimited-A"], [tail, "blob:old-tail"],
    [b, "blob:new-delimited-B"], [other, "blob:new-tail"]]);
  loadBlob.mockImplementation((key: string) => blobByKey.get(key) ?? Promise.reject(new Error("unexpected test key")));
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true, value: vi.fn((blob: Blob) => blobUrl.get(blob) ?? "blob:unexpected"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

  const view = render(<QuestionExhibits attachments={old} />);
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "A first" }).getAttribute("src")).toBe("blob:old-delimited-A");
  });

  view.rerender(<QuestionExhibits attachments={newer} />);
  expect(screen.queryByRole("img", { name: "B first" })).toBeNull();
  expect(view.container.querySelector('img[src="blob:old-delimited-A"]')).toBeNull();
  pendingB.resolve({ blob: b });
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "B first" }).getAttribute("src")).toBe("blob:new-delimited-B");
  });
});

test("late A blob resolution after A→B cleanup never creates an orphaned private object URL", async () => {
  const delayedA = deferred<{ blob: Blob }>();
  const a = new Blob(["synthetic A, late"], { type: "image/png" });
  const b = new Blob(["synthetic B, current"], { type: "image/png" });
  const create = vi.fn((blob: Blob) => blob === a ? "blob:orphaned-A" : blob === b ? "blob:current-B" : "blob:unknown");
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  loadBlob.mockImplementation((key: string) => {
    if (key === "synthetic:late-A") return delayedA.promise;
    if (key === "synthetic:current-B") return Promise.resolve({ blob: b });
    throw new Error("Unexpected key: " + key);
  });
  const sourceA: QuestionImageAttachment = { ...common, altText: "Delayed A", blobKey: "synthetic:late-A" };
  const sourceB: QuestionImageAttachment = { ...common, altText: "Current B", blobKey: "synthetic:current-B" };
  const view = render(<QuestionExhibits attachments={[sourceA]} />);
  await waitFor(() => expect(loadBlob).toHaveBeenCalledWith("synthetic:late-A"));
  view.rerender(<QuestionExhibits attachments={[sourceB]} />);
  await waitFor(() => expect(screen.getByRole("img", { name: "Current B" }).getAttribute("src")).toBe("blob:current-B"));

  // A's cancelled async operation must not create URLs after its cleanup ran.
  await act(async () => { delayedA.resolve({ blob: a }); await delayedA.promise; });
  expect(create).not.toHaveBeenCalledWith(a);
  expect(create).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalledWith("blob:orphaned-A");
  expect(screen.getByRole("img", { name: "Current B" }).getAttribute("src")).toBe("blob:current-B");
});
