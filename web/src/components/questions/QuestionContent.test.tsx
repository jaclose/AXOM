// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionAsset, PackageQuestion } from "../../lib/question-content/package";
import { QuestionBlocks } from "./QuestionContent";

const source = (id: string): QuestionAsset => ({
  id: "shared-asset-id", questionId: "sample-q", filename: "source-figure.png", mimeType: "image/png",
  role: "question", checksum: `sha256:${id.repeat(64)}`,
});
const content = (asset: QuestionAsset): PackageQuestion =>
  ({ id: "sample-q", assets: [asset], stem: [] }) as unknown as PackageQuestion;
const blocks = [{ type: "image" as const, assetId: "shared-asset-id", alt: "Clinical source figure", role: "question" as const }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("source figure lifecycle and rapid question navigation", () => {
  it("never renders the previous question's image while the next asset loads", async () => {
    const oldFile = new File(["a"], "source-figure.png", { type: "image/png", lastModified: 1 });
    const nextFile = new File(["b"], "source-figure.png", { type: "image/png", lastModified: 2 });
    const create = vi.fn((blob: Blob) => blob === oldFile ? "blob:axom-old" : "blob:axom-next");
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });

    const firstAsset = source("a");
    const view = render(<QuestionBlocks blocks={blocks} content={content(firstAsset)}
      files={[oldFile]} mode="question" />);
    await waitFor(() => expect(screen.getByRole("img", { name: "Clinical source figure" }).getAttribute("src"))
      .toBe("blob:axom-old"));

    // Asset IDs and basenames can repeat in separate medical question packages.
    // A changing checksum/File must immediately invalidate the old object URL.
    const secondAsset = source("b");
    view.rerender(<QuestionBlocks blocks={blocks} content={content(secondAsset)}
      files={[nextFile]} mode="question" />);
    // A local File can load synchronously inside React's act/rerender. The
    // important invariant is that the old figure is NEVER still displayed.
    expect(screen.queryByRole("img", { name: "Clinical source figure" })?.getAttribute("src"))
      .not.toBe("blob:axom-old");

    await waitFor(() => expect(screen.getByRole("img", { name: "Clinical source figure" }).getAttribute("src"))
      .toBe("blob:axom-next"));
    expect(revoke).toHaveBeenCalledWith("blob:axom-old");

    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:axom-next");
  });
});
