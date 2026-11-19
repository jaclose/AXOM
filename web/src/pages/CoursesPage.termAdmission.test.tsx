// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import type { TrackerItem } from "../lib/types";
import { CoursesPage } from "./CoursesPage";

const original: TrackerItem = {
  id: "row-47", path: "Unowned/Week 1", label: "Original source 47",
  kind: "Lecture", passes: 2, ankiPasses: 1, yield: "high",
  updated: "2026-11-01T09:00:00Z", attendance: "missed", templateKey: "original-47",
};

beforeEach(() => {
  useStore.setState(makeSeed());
  useStore.setState({
    terms: [{ id: "term-1", name: "Term 1" }],
    courses: [],
    tracker: [original],
  });
});
afterEach(cleanup);

function openTermEditor() {
  fireEvent.click(screen.getByText("Add term"));
  return within(screen.getByRole("dialog"));
}

describe("Add Term learner-visible ownership holds", () => {
  it("keeps the editor open with an accessible error on case-equivalent duplicate", () => {
    render(<CoursesPage />);
    const dialog = openTermEditor();
    fireEvent.change(dialog.getByLabelText("Term name"), { target: { value: "  tErM   1 " } });
    fireEvent.click(dialog.getByRole("button", { name: "Add" }));
    expect(dialog.getByRole("alert").textContent).toMatch(/already owns/i);
    expect(dialog.getByLabelText("Term name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(useStore.getState().terms).toEqual([{ id: "term-1", name: "Term 1" }]);
    expect(useStore.getState().tracker).toEqual([original]);
  });

  it("does not silently claim an orphan Course Tracker root", () => {
    render(<CoursesPage />);
    const dialog = openTermEditor();
    fireEvent.change(dialog.getByLabelText("Term name"), { target: { value: "Unowned" } });
    fireEvent.click(dialog.getByRole("button", { name: "Add" }));
    expect(dialog.getByRole("alert").textContent).toMatch(/Course Tracker activity/i);
    expect(useStore.getState().terms).toHaveLength(1);
    expect(useStore.getState().tracker[0]).toEqual(original);
    fireEvent.change(dialog.getByLabelText("Term name"), { target: { value: "Term 3" } });
    expect(dialog.queryByRole("alert")).toBeNull();
  });

  it("adds a disjoint normalized term and closes the editor without changing saved progress", () => {
    render(<CoursesPage />);
    const dialog = openTermEditor();
    fireEvent.change(dialog.getByLabelText("Term name"), { target: { value: "  Term   3 " } });
    fireEvent.click(dialog.getByRole("button", { name: "Add" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useStore.getState().terms.map((term) => term.name)).toEqual(["Term 1", "Term 3"]);
    expect(useStore.getState().tracker).toEqual([original]);
  });
});
