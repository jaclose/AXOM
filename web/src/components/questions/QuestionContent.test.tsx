// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuestionAsset, PackageQuestion } from "../../lib/question-content/package";
import { getQuestionAttachmentBlob, type QuestionImageAttachment } from "../../lib/questionAttachments";
import { questionMappingStatus, type QuestionRecord } from "../../lib/questions";
import { QuestionBlocks, QuestionContent, QuestionSupportingContent } from "./QuestionContent";

vi.mock("../../lib/questionAttachments", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/questionAttachments")>(),
  getQuestionAttachmentBlob: vi.fn(),
}));

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
  it("enlarges a source figure with zoom controls while retaining its authored crop", async () => {
    const file = new File(["synthetic"], "source-figure.png", { type: "image/png" });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:cropped") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const asset = { ...source("a"), width: 1000, height: 600, crop: { left: .25, right: .25, top: .1, bottom: .4 } };
    render(<QuestionBlocks blocks={blocks} content={content(asset)} files={[file]} mode="question" />);
    fireEvent.click(await screen.findByRole("button", { name: "Enlarge Clinical source figure" }));
    const dialog = screen.getByRole("dialog", { name: "Clinical source figure" });
    const image = within(dialog).getByRole("img");
    expect(image.getAttribute("src")).toBe("blob:cropped");
    expect(image.style.position).toBe("absolute"); expect(image.style.left).toBe("-250px");
    fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in" }));
    expect(image.style.left).toBe("-375px"); expect(image.parentElement?.style.width).toBe("750px");
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "Close" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("img", { name: "Clinical source figure" })).toBeTruthy();
  });
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

  it("keeps a required source figure visible after the reviewed stem text is edited", async () => {
    const asset: QuestionAsset = {
      id: "edited-stem-figure", questionId: "edited-stem-question", filename: "edited-stem.png",
      mimeType: "image/png", role: "stem", checksum: `sha256:${"a".repeat(64)}`,
    };
    const answerAsset: QuestionAsset = {
      id: "edited-stem-answer", questionId: asset.questionId, filename: "edited-stem-answer.png",
      mimeType: "image/png", role: "answer_reveal", revealOf: asset.id,
    };
    const attachment: QuestionImageAttachment = {
      id: "edited-stem-attachment", assetId: asset.id, fileName: asset.filename, mimeType: "image/png",
      byteSize: 3, altText: "", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
      blobKey: "edited-stem-blob", role: "stem",
    };
    const question: QuestionRecord = {
      id: "edited-stem-question", source: "imported", stem: "Reviewed wording asks for the diagnosis.",
      options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }], correctKey: "B",
      correctAnswerText: "Beta", status: "unseen", tags: [], attempts: [], createdAt: "2026-10-15T00:00:00.000Z",
      updatedAt: "2026-10-15T00:00:00.000Z", extraction: { confidence: "high", reviewed: true },
      attachments: [attachment],
      content: {
        id: asset.questionId, source: { filename: "source.pdf", questionNumber: 1 },
        stem: [
          { type: "text", text: "Original source wording asks for the diagnosis." },
          { type: "image", assetId: asset.id, alt: "Essential diagnostic figure" },
          { type: "image", assetId: answerAsset.id, alt: "Answer-marked source slide" },
        ],
        choices: [{ id: "a", label: "A", blocks: [{ type: "text", text: "Alpha" }] }, { id: "b", label: "B", blocks: [{ type: "text", text: "Beta" }] }],
        correctAnswer: { labels: ["B"], evidence: "printed-key" }, assets: [asset, answerAsset], provenance: { method: "pdf-import" },
      },
    };
    vi.mocked(getQuestionAttachmentBlob).mockResolvedValue({
      blob: new Blob(["png"], { type: "image/png" }), mimeType: "image/png", byteSize: 3,
      questionId: question.id, updatedAt: attachment.updatedAt,
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:edited-stem") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

    expect(questionMappingStatus(question)).toBe("ready");
    const view = render(<QuestionContent question={question} part="stem" fallback={<p>{question.stem}</p>} />);

    expect(screen.getByText(question.stem)).toBeTruthy();
    expect(view.container.querySelector('[data-asset-role="answer_reveal"]')).toBeNull();
    await waitFor(() => expect(screen.getByRole("img", { name: "Essential diagnostic figure" }).getAttribute("src"))
      .toBe("blob:edited-stem"));
  });
});

it("separates explanation figures from source references without revealing them while solving", () => {
  const roles = ["question", "explanation", "answer_reveal", "reference", "source_page"] as const;
  const question: QuestionRecord = { id: "synthetic", source: "imported", stem: "A synthetic source question.",
    options: [{ key: "A", text: "Alpha" }, { key: "B", text: "Beta" }], correctKey: "B", status: "unseen", tags: [], attempts: [],
    createdAt: "2026-11-21", updatedAt: "2026-11-21", content: {
      id: "synthetic", source: { filename: "Synthetic.pdf" }, stem: [], choices: [], provenance: { method: "authored" },
      assets: roles.map(role => ({ id: role, questionId: "synthetic", filename: `${role}.png`, mimeType: "image/png", role })),
    } };
  const view = render(<QuestionSupportingContent question={question} mode="question" />);
  const displayed = () => [...view.container.querySelectorAll("[data-asset-role]")].map(element => element.getAttribute("data-asset-role"));
  expect(displayed()).toEqual(["question"]);
  expect(screen.queryByRole("region", { name: "Explanation figures" })).toBeNull();
  view.rerender(<QuestionSupportingContent question={question} mode="answered" />);
  expect(displayed()).toEqual(["explanation", "answer_reveal", "reference"]);
  expect(screen.getByRole("region", { name: "Explanation figures" }).querySelectorAll('[data-asset-role="explanation"]')).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Source slides and references" }).querySelectorAll("figure")).toHaveLength(2);
  view.rerender(<QuestionSupportingContent question={question} mode="review" />);
  expect(displayed()).toEqual(["explanation", "answer_reveal", "reference", "source_page"]);
});
