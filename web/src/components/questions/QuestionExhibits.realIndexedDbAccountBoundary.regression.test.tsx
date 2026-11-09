// @vitest-environment jsdom
// MOTHERSHIP R18: REAL device-local IndexedDB, not a mocked per-account blob loader.
// Synthetic users and bytes only. A RED here does not establish a hosted incident.
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAccount } from "../../lib/account/accountStore";
import {
  getQuestionAttachmentBlob,
  putQuestionAttachmentBlob,
  type QuestionImageAttachment,
} from "../../lib/questionAttachments";
import { initializeQuestionAttachmentScope, resetQuestionAttachmentScopeForTests, setQuestionAttachmentAccount } from "../../lib/questionAttachmentScope";
import { DB_NAME } from "../../lib/localVault";
import { QuestionExhibits } from "./QuestionExhibits";
import { QuestionAttachmentsPanel } from "./QuestionAttachmentsPanel";
import { QuestionContent } from "./QuestionContent";
import { useExhibitUrls } from "../exam/parts";
import type { QuestionRecord } from "../../lib/questions";

vi.mock("../../lib/account/accountStore", async () => {
  const { create } = await import("zustand");
  return { useAccount: create(() => ({
    phase: "signed-in", link: "linked",
    user: { id: "synthetic-A", email: "", displayName: "", emailConfirmed: true },
  })) };
});

let unbindScope: (() => void) | undefined;
const KEY = "same-idb-key-across-authenticated-users";
const DATE = "2026-11-09T00:00:00.000Z";
const FILE_A = "SYNTHETIC_PRIVATE_IMAGE_ONLY_ACCOUNT_A";

// fake-indexeddb uses structuredClone; native Node Blob retains its bytes and
// prototype across that clone, unlike jsdom Blob in this Node test runner.
// Byte checks must exercise the persisted record, not skip past the setup.
function readBlobText(blob: Blob): Promise<string> {
  return blob.text();
}
const attachment: QuestionImageAttachment = {
  id: "same-image-id", blobKey: KEY, createdAt: DATE, updatedAt: DATE,
  fileName: "synthetic.png", mimeType: "image/png", byteSize: FILE_A.length,
  altText: "Synthetic question diagram", role: "exhibit",
};

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? Error("Failed to reset synthetic IDB"));
    request.onblocked = () => reject(Error("A synthetic IDB connection remained open"));
  });
}

beforeEach(async () => {
  // Keep real structured-cloned Blob bytes through fake-indexeddb transactions.
  // The default jsdom Blob loses its brand in this test environment.
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  await deleteDatabase(DB_NAME);
  resetQuestionAttachmentScopeForTests();
  useAccount.setState({
    phase: "signed-in", link: "linked",
    user: { id: "synthetic-A", email: "", displayName: "", emailConfirmed: true },
  });
  initializeQuestionAttachmentScope("synthetic-A", "synthetic-A");
  unbindScope = useAccount.subscribe(state => setQuestionAttachmentAccount(state.user?.id));
});

afterEach(() => {
  cleanup();
  unbindScope?.();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

test("A persisted attachment cannot be reacquired and displayed for B before B has hydrated its own image bytes", async () => {
  // This is the actual questionAttachmentBlobs storage API, NOT R27's mocked
  // getQuestionAttachmentBlob. Each call opens a fresh IDB connection.
  await putQuestionAttachmentBlob(KEY, {
    blob: new Blob([FILE_A], { type: "image/png" }),
    mimeType: "image/png", byteSize: FILE_A.length,
    questionId: "same-question-id", updatedAt: DATE,
  });
  const persisted = await getQuestionAttachmentBlob(KEY, { localOnly: true });
  expect(await readBlobText(persisted!.blob)).toBe(FILE_A);

  const allocated: Blob[] = [];
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true, value: vi.fn((blob: Blob) => {
      allocated.push(blob);
      return `blob:synthetic-attachment-${allocated.length}`;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });

  const view = render(<QuestionExhibits attachments={[attachment]} />);
  await waitFor(() => expect(screen.getByRole("img", { name: attachment.altText }).getAttribute("src"))
    .toBe("blob:synthetic-attachment-1"));
  expect(await readBlobText(allocated[0])).toBe(FILE_A);
  const opener = screen.getByRole("button", { name: `Enlarge ${attachment.altText}` });
  fireEvent.click(opener);
  expect(screen.getByRole("dialog", { name: attachment.altText })).toBeTruthy();

  // B's authenticated session has changed. B's workspace/image has NOT been
  // hydrated. The metadata tuple, source id and blobKey intentionally collide.
  await act(async () => {
    useAccount.setState({
      phase: "signed-in", link: "linked-elsewhere",
      user: { id: "synthetic-B", email: "", displayName: "", emailConfirmed: true },
    });
  });
  view.rerender(<QuestionExhibits attachments={[attachment]} />);

  // A's old object URL is immediately revoked by R27. That alone is NOT
  // sufficient: the unpartitioned IndexedDB read can allocate another A URL.
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:synthetic-attachment-1"));
  // Security acceptance: no speculative B image when the only persisted bytes
  // belong to A. Render an unavailable/missing state, not A's image or a
  // permanently spinning loading placeholder. The current implementation is
  // now guarded by account-scoped storage as well as URL invalidation.
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("img", { name: attachment.altText })).toBeNull();
    expect(screen.getByText(/synthetic[.]png.*(?:not on this device|not available|could not be displayed|not accessible)/i)).toBeTruthy();
  });
  expect(document.activeElement).not.toBe(opener);
  expect(allocated).toHaveLength(1);
  view.unmount();
});

test("every mounted image surface discards A URLs for B and recovers A's preserved bytes on return", async () => {
  await putQuestionAttachmentBlob(KEY, {
    blob: new Blob([FILE_A], { type: "image/png" }), mimeType: "image/png", byteSize: FILE_A.length,
    questionId: "same-question-id", updatedAt: DATE,
  });
  const allocated: Blob[] = [];
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => {
    allocated.push(blob); return `blob:mounted-${allocated.length}`;
  }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  const richAttachment = { ...attachment, assetId: "asset", role: "stem" as const };
  const question: QuestionRecord = {
    id: "same-question-id", source: "manual", stem: "", options: [], status: "unseen", tags: [], attempts: [],
    createdAt: DATE, updatedAt: DATE, attachments: [richAttachment],
    content: {
      id: "same-question-id", source: { filename: "synthetic.pdf" }, stem: [{ type: "image", assetId: "asset", alt: "Rich source figure" }],
      choices: [], assets: [{ id: "asset", questionId: "same-question-id", filename: attachment.fileName, mimeType: "image/png", role: "stem" }],
      provenance: { method: "pdf-import" },
    },
  };
  function ExamImage() {
    const urls = useExhibitUrls([attachment]);
    return urls[attachment.id] ? <img src={urls[attachment.id]} alt="Exam image" /> : <span>Exam image unavailable</span>;
  }
  const view = render(<>
    <QuestionExhibits attachments={[attachment]} />
    <QuestionAttachmentsPanel questionId={question.id} attachments={[attachment]} onChange={vi.fn()} />
    <QuestionContent question={question} part="stem" fallback={null} />
    <ExamImage />
  </>);
  await waitFor(() => expect(view.container.querySelectorAll("img[src]")).toHaveLength(4));
  expect(allocated).toHaveLength(4);
  await act(async () => { useAccount.setState({ user: { id: "synthetic-B", email: "", displayName: "", emailConfirmed: true } }); });
  await waitFor(() => expect(view.container.querySelectorAll("img[src]")).toHaveLength(0));
  await waitFor(() => expect(revoke).toHaveBeenCalledTimes(4));
  expect(allocated).toHaveLength(4);
  await act(async () => { useAccount.setState({ user: { id: "synthetic-A", email: "", displayName: "", emailConfirmed: true } }); });
  await waitFor(() => expect(view.container.querySelectorAll("img[src]")).toHaveLength(4));
  expect(allocated).toHaveLength(8);
  expect(await Promise.all(allocated.map(blob => blob.text()))).toEqual(Array(8).fill(FILE_A));
});
