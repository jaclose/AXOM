// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WeekOverview } from "./WeekOverview";

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("../../lib/store", () => ({ useStore: () => mocks.state }));
vi.mock("../ui/primitives", () => ({
  GlassCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  PanelHeader: ({ title, sub }: { title: string; sub?: string }) =>
    <header><h2>{title}</h2>{sub && <p>{sub}</p>}</header>,
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const at = "2026-11-07T00:00:00.000Z";
const course = (id: string, code: string) => ({
  id, code, name: code, termId: "term2", files: 0,
  modules: [{ id: `module-${id}`, name: "NB2" }],
});
const question = (id: string, courseId: string) => ({
  id, courseId, module: "NB2", week: 3, source: "imported", stem: id,
  status: "correct", options: [], tags: [], createdAt: at, updatedAt: at,
  attempts: [{ at, status: "correct" }],
});
const trackerRow = {
  id: "lecture-1", path: "Term 2/NB2/Week 3", label: "Lecture 1",
  kind: "Lecture", activity: "lecture", passes: 1, ankiPasses: 0,
  yield: "none", updated: at,
};

afterEach(() => {
  cleanup();
  mocks.state = {};
});

describe("Course Tracker week question progress ownership", () => {
  it("explains withheld QBank progress when same-term courses both own the legacy module", () => {
    mocks.state = {
      tracker: [trackerRow],
      questions: [question("core-q", "core"), question("elective-q", "elective")],
      questionSets: [],
      terms: [{ id: "term2", name: "Term 2" }],
      courses: [course("core", "BPM 501"), course("elective", "ELECTIVE")],
    };
    render(<WeekOverview />);
    expect(screen.getByText("Question progress unavailable: course ownership needs review.")).toBeTruthy();
    expect(screen.queryByText(/Questions: 2 of 2 answered/)).toBeNull();
    expect(screen.getAllByText(/1 of 1 done/).length).toBeGreaterThan(0);
  });

  it("continues displaying verified per-course answers when a legacy week has one owner", () => {
    mocks.state = {
      tracker: [trackerRow],
      questions: [question("core-q", "core"), question("foreign-q", "foreign")],
      questionSets: [],
      terms: [{ id: "term2", name: "Term 2" }],
      courses: [course("core", "BPM 501"), {
        id: "foreign", code: "OTHER", name: "Other", termId: "term2", files: 0,
        modules: [{ id: "other-module", name: "FTM 1" }],
      }],
    };
    render(<WeekOverview />);
    expect(screen.getByText("Questions: 1 of 1 answered, 100% right first time")).toBeTruthy();
    expect(screen.queryByText(/course ownership needs review/)).toBeNull();
  });
});
