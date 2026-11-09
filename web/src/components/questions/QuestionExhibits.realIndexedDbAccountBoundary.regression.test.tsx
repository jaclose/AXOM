// @vitest-environment jsdom
// MOTHERSHIP R18: REAL device-local IndexedDB, not a mocked per-account blob loader.
// Synthetic users and bytes only. A RED here does not establish a hosted incident.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { indexedDB as fakeIndexedDb, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { create } from "zustand";
import { useAccount } from "../../lib/account/accountStore";
import {
  getQuestionAttachmentBlob,
  putQuestionAttachmentBlob,
  type QuestionImageAttachment,
} from "../../lib/questionAttachments";
import { DB_NAME } from "../../lib/localVault";
import { QuestionExhibits } from "./QuestionExhibits";

vi.mock("../../lib/account/accountStore", () => ({
  useAccount: create(() => ({
    phase: "signed-in",
    user: { id: "synthetic-A", email: "", displayName: "", emailConfirmed: true },
  })),
}));

const KEY = "same-idb-key-across-authenticated-users";
const DATE = "2026-11-09T00:00:00.000Z";
const FILE_A = "SYNTHETIC_PRIVATE_IMAGE_ONLY_ACCOUNT_A";
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
  vi.stubGlobal("indexedDB", fakeIndexedDb);
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  await deleteDatabase(DB_NAME);
  useAccount.setState({
    phase: "signed-in",
    user: { id: "synthetic-A", email: "", displayName: "", emailConfirmed: true },
  });
});

afterEach(() => {
  cleanup();
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
  expect(await persisted?.blob.text()).toBe(FILE_A);

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
  expect(await allocated[0].text()).toBe(FILE_A);

  // B's authenticated session has changed. B's workspace/image has NOT been
  // hydrated. The metadata tuple, source id and blobKey intentionally collide.
  await act(async () => {
    useAccount.setState({
      phase: "signed-in",
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
  // expected to be RED; do not claim this is fixed by R27/R28.
  await waitFor(() => {
    expect(screen.queryByRole("img", { name: attachment.altText })).toBeNull();
    expect(screen.getByText(/synthetic\\.png.*(?:not on this device|not available|could not be displayed|not accessible)/i)).toBeTruthy();
  });
  expect(allocated).toHaveLength(1);
  view.unmount();
});
