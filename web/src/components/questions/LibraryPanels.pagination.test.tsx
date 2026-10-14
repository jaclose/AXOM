// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceDocument } from "../../lib/library";
import { SourceLibrary } from "./LibraryPanels";

const mock = vi.hoisted(() => ({ documents: [] as SourceDocument[] }));
vi.mock("../../lib/store", () => ({ useStore: () => mock }));
vi.mock("../../lib/ai", () => ({ resolveActiveProvider: () => null }));
vi.mock("../../lib/toast", () => ({ pushToast: vi.fn() }));

function documentRow(i: number): SourceDocument {
  return {
    id: `source-${i}`, title: `Source ${i}`, fileName: `source-${i}.pdf`,
    fileType: "pdf", rawText: "", sizeBytes: 2048, tags: [],
    uploadedAt: "2026-10-14T00:00:00.000Z", linkedQuestionSetIds: [],
    libraryOnly: true,
  };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("SourceLibrary bounded browsing", () => {
  it("renders source rows in progressive pages instead of mounting the entire library", async () => {
    mock.documents = Array.from({ length: 105 }, (_, i) => documentRow(i + 1));
    const user = userEvent.setup();
    const { container } = render(<SourceLibrary onParseFrom={vi.fn()} onGenerateFrom={vi.fn()} />);
    expect(container.querySelectorAll(".import-draft")).toHaveLength(40);
    expect(screen.getByText("Showing 40 of 105 source documents")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show 40 more sources" }));
    expect(container.querySelectorAll(".import-draft")).toHaveLength(80);
    await user.click(screen.getByRole("button", { name: "Show 25 more sources" }));
    expect(container.querySelectorAll(".import-draft")).toHaveLength(105);
    expect(screen.queryByRole("button", { name: /Show .* more sources/ })).toBeNull();
  });

  it("resets pagination when searching, keeping exact source matching visible", async () => {
    mock.documents = Array.from({ length: 105 }, (_, i) => documentRow(i + 1));
    const user = userEvent.setup();
    const { container } = render(<SourceLibrary onParseFrom={vi.fn()} onGenerateFrom={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Show 40 more sources" }));
    await user.type(screen.getByRole("textbox", { name: "Search source documents" }), "Source 105");
    expect(container.querySelectorAll(".import-draft")).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 1 source documents")).toBeTruthy();
    await user.clear(screen.getByRole("textbox", { name: "Search source documents" }));
    expect(container.querySelectorAll(".import-draft")).toHaveLength(40);
  });
});
