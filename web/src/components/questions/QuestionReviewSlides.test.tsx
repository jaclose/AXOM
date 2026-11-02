// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { QuestionRecord } from "../../lib/questions";
import type { QuestionBlock } from "../../lib/question-content/blocks";
import { QuestionReviewSlides } from "./QuestionReviewSlides";

vi.mock("./QuestionContent", () => ({
  QuestionBlocks: ({ blocks }: { blocks: QuestionBlock[] }) => <div>{blocks.map((block) => block.type === "image" ? block.alt : "").join(" | ")}</div>,
}));

afterEach(cleanup);

it("keeps the source page's precise description in completed-session Slides", () => {
  const description = "Original text-only question page; no radiograph image supplied.";
  const question = {
    id: "q1", source: "imported", stem: "A radiograph is described in the text.",
    options: [{ key: "A", text: "Choice A" }, { key: "B", text: "Choice B" }],
    status: "unseen", tags: [], attempts: [], createdAt: "x", updatedAt: "x",
    content: {
      id: "q1", source: { filename: "source.pdf", page: 1 },
      stem: [{ type: "text", text: "A radiograph is described in the text." },
        { type: "image", assetId: "text-page", role: "source_page", alt: description }],
      choices: [], assets: [
        { id: "text-page", filename: "text-page.png", mimeType: "image/png", role: "source_page", questionId: "q1" },
        { id: "other-page", filename: "other-page.png", mimeType: "image/png", role: "source_page", questionId: "q1" },
      ],
      provenance: { method: "authored" },
    },
  } as QuestionRecord;
  render(<QuestionReviewSlides question={question} />);
  expect(screen.getByText(`${description} | Original source slide`)).toBeTruthy();
});
