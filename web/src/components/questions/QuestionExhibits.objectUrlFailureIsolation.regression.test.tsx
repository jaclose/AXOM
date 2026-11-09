// @vitest-environment jsdom
// R28: one failed browser object-URL allocation must not suppress adjacent exhibits.
// Synthetic fixtures only. This is not an authenticated attachment-provenance test.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { QuestionImageAttachment } from "../../lib/questionAttachments";
import { QuestionExhibits } from "./QuestionExhibits";

const { readBlob } = vi.hoisted(() => ({ readBlob: vi.fn() }));
vi.mock("../../lib/questionAttachments", () => ({ getQuestionAttachmentBlob: readBlob }));
vi.mock("../../lib/account/accountStore", async () => {
  const { create } = await import("zustand");
  return { useAccount: create(() => ({ phase: "signed-in", user: { id: "synthetic-owner-A" } })) };
});

const names = ["first", "broken", "third"] as const;
const attachments: QuestionImageAttachment[] = names.map((name) => ({
  id: `synthetic-${name}`,
  blobKey: `blob-synthetic-${name}`,
  fileName: `synthetic-${name}.png`,
  mimeType: "image/png",
  byteSize: 20,
  altText: `Synthetic ${name} image`,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
  role: "exhibit",
}));

afterEach(() => {
  cleanup();
  readBlob.mockReset();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

test("failure to create one object URL leaves other images accessible and revocable", async () => {
  const first = new Blob(["synthetic first bytes"], { type: "image/png" });
  const broken = new Blob(["synthetic broken bytes"], { type: "image/png" });
  const third = new Blob(["synthetic third bytes"], { type: "image/png" });
  const blobs = new Map([
    ["blob-synthetic-first", first],
    ["blob-synthetic-broken", broken],
    ["blob-synthetic-third", third],
  ]);
  readBlob.mockImplementation(async (key: string) => {
    const blob = blobs.get(key);
    if (!blob) throw new Error("Unexpected synthetic blob key");
    return { blob };
  });

  const created = vi.fn((blob: Blob) => {
    if (blob === broken) throw new Error("Synthetic browser object URL allocation failure");
    if (blob === first) return "blob:synthetic-first";
    if (blob === third) return "blob:synthetic-third";
    throw new Error("Unexpected synthetic blob");
  });
  const revoked = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: created });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoked });

  const view = render(<QuestionExhibits attachments={attachments} />);
  await waitFor(() => {
    expect(screen.getByRole("img", { name: "Synthetic first image" }).getAttribute("src")).toBe("blob:synthetic-first");
    expect(screen.getByRole("img", { name: "Synthetic third image" }).getAttribute("src")).toBe("blob:synthetic-third");
    expect(screen.getByText("synthetic-broken.png could not be displayed on this device.")).toBeTruthy();
  });

  expect(screen.getByRole("button", { name: "Enlarge Synthetic first image" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Enlarge Synthetic third image" })).toHaveProperty("disabled", false);
  expect(screen.queryByRole("img", { name: "Synthetic broken image" })).toBeNull();
  expect(readBlob).toHaveBeenCalledTimes(3);
  expect(created.mock.calls.map(([blob]) => blob)).toEqual([first, broken, third]);

  view.unmount();
  expect(revoked.mock.calls.map(([url]) => url).sort()).toEqual(["blob:synthetic-first", "blob:synthetic-third"]);
});
