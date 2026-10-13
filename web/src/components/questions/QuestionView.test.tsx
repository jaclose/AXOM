// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QuestionViewControls, QuestionViewFrame, useQuestionView } from "./QuestionView";

const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, value); },
};

function View() {
  const presentation = useQuestionView();
  return <><QuestionViewControls view={presentation.view} onChange={presentation.choose} notice={presentation.notice} mode="exam" />
    <QuestionViewFrame view={presentation.view}><input aria-label="Draft answer" /></QuestionViewFrame></>;
}
beforeEach(() => { vi.stubGlobal("localStorage", storage); storage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("question presentation", () => {
  it("keeps the same answer DOM and remembers the selected view across mounts", () => {
    const first = render(<View />);
    const answer = screen.getByLabelText("Draft answer");
    fireEvent.change(answer, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    expect(screen.getByLabelText("Draft answer")).toBe(answer);
    expect((answer as HTMLInputElement).value).toBe("A");
    expect(screen.getByRole("button", { name: "Exam (feedback at the end)" })).toBeDisabled();
    first.unmount(); render(<View />);
    expect(screen.getByRole("button", { name: "Slides" })).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps the view usable and explains a failed preference write", () => {
    render(<View />);
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    expect(screen.getByRole("button", { name: "Slides" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("could not be remembered");
  });
});
