// @vitest-environment jsdom
// R26: adversarial but valid attachment IDs; only synthetic image bytes.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionExhibits } from "./QuestionExhibits";

const { readBlob } = vi.hoisted(() => ({ readBlob: vi.fn() }));
vi.mock("../../lib/questionAttachments", () => ({ getQuestionAttachmentBlob: readBlob }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  readBlob.mockReset();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

test("prototype-inherited attachment IDs never turn an unresolved blob into a phantom exhibit", async () => {
  // The metadata normalizer accepts these nonempty IDs. An ordinary {} URL
  // dictionary would inherit __proto__ and constructor before a Blob is read.
  const protoBlob = new Blob(["synthetic proto pixels"], { type: "image/png" });
  const constructorBlob = new Blob(["synthetic constructor pixels"], { type: "image/png" });
  const protoPending = deferred<{ blob: Blob }>();
  const constructorPending = deferred<{ blob: Blob }>();
  const create = vi.fn((blob: Blob) => blob === protoBlob
    ? "blob:resolved-proto" : blob === constructorBlob ? "blob:resolved-constructor" : "blob:unexpected");
  const revoke = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  readBlob.mockImplementation((key: string) => {
    if (key === "synthetic:proto") return protoPending.promise;
    if (key === "synthetic:constructor") return constructorPending.promise;
    throw new Error("Unexpected attachment lookup");
  });

  const base = {
    fileName: "synthetic-exhibit.png", mimeType: "image/png", byteSize: 24,
    altText: "", createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
    role: "exhibit",
  } as const;
  const attachments: QuestionImageAttachment[] = [
    { ...base, id: "__proto__", blobKey: "synthetic:proto", altText: "Prototype exhibit" },
    { ...base, id: "constructor", blobKey: "synthetic:constructor", altText: "Constructor exhibit" },
  ];

  const view = render(<QuestionExhibits attachments={attachments} />);
  await waitFor(() => expect(readBlob).toHaveBeenCalledWith("synthetic:proto"));
  for (const name of ["Prototype exhibit", "Constructor exhibit"]) {
    expect((screen.getByRole("button", { name: `Enlarge ${name}` }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("img", { name })).toBeNull();
  }
  expect(create).not.toHaveBeenCalled();

  await act(async () => {
    protoPending.resolve({ blob: protoBlob });
    await protoPending.promise;
  });
  await waitFor(() => expect(readBlob).toHaveBeenCalledWith("synthetic:constructor"));
  await act(async () => {
    constructorPending.resolve({ blob: constructorBlob });
    await constructorPending.promise;
  });
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "Prototype exhibit" }).getAttribute("src")).toBe("blob:resolved-proto");
    expect(screen.getByRole("img", { name: "Constructor exhibit" }).getAttribute("src")).toBe("blob:resolved-constructor");
  });
  expect(create.mock.calls.map(([blob]) => blob)).toEqual([protoBlob, constructorBlob]);
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:resolved-proto");
  expect(revoke).toHaveBeenCalledWith("blob:resolved-constructor");
  expect(revoke).toHaveBeenCalledTimes(2);
});
