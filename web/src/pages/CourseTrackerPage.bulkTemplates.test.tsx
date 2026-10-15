// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SourceDocument } from "../lib/library";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { BulkCurriculumTemplateInstall } from "./CourseTrackerPage.bulkTemplates";

vi.mock("../lib/localVault", () => ({
  getVaultWriteCheckpoint: vi.fn(() => 0),
  flushLocalVaultWrites: vi.fn(async () => {}),
  assertVaultWritesSince: vi.fn(),
}));

const syntheticSource = (id: string, title: string, text: string): SourceDocument => ({
  id, title, fileName: title, fileType: "axom-course-template",
  uploadedAt: "2026-10-14T12:00:00.000Z", rawText: text,
  checksum: id, sizeBytes: text.length, linkedQuestionSetIds: [],
  tags: ["course-template"], libraryOnly: true,
});
const lecture = syntheticSource("nb2-lectures", "NB lectures",
  "NB Block 2 - Lectures:\n\nNB Lecture 01 Synaptic Transmission [Lecture]");
const events = syntheticSource("nb2-activities", "NB small groups",
  "NB2 - Small Groups:\n\nWeek 4 IMCQ [IMCQ]\nNB SG 01 Sensory Systems [Small Group]");
beforeEach(() => {
  useStore.setState(makeSeed());
  useStore.setState({ documents: [lecture, events], tracker: [], terms: [], courses: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Course Tracker current-sources bulk installation", () => {
  it("shows a reviewable conservative plan, creates only known rows, and is idempotent", async () => {
    const { container } = render(<BulkCurriculumTemplateInstall />);
    fireEvent.click(screen.getByText("Install saved curriculum activities"));
    expect(screen.getByText(/2 source templates/)).toBeTruthy();
    expect(screen.getByText(/3 known activities/)).toBeTruthy();
    expect(container.textContent).toContain("2 activities without a confirmed week");
    fireEvent.click(screen.getByRole("button", { name: "Review 1 modules" }));
    expect(screen.getByLabelText("Source-by-module installation review").textContent)
      .toContain("Term 2/BPM 501/NB2");
    fireEvent.click(screen.getByRole("button", { name: "Install 3 and revise 0" }));
    await waitFor(() => expect(useStore.getState().tracker).toHaveLength(3));
    const state = useStore.getState();
    expect(state.tracker.filter((row) => row.path.endsWith("Unscheduled"))).toHaveLength(2);
    expect(state.tracker.filter((row) => row.path.endsWith("/Week 4"))).toHaveLength(1);
    expect(state.terms.map((term) => term.name)).toEqual(["Term 2"]);
    expect(state.courses.map((course) => [course.code, course.modules[0]?.name])).toEqual([["BPM 501", "NB2"]]);
    expect(state.tracker.every((row) => row.passes === 0 && row.ankiPasses === 0)).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/saved on this device/);
    expect((screen.getByRole("button", { name: "Already represented" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires affirmative consent for inferred week placements", async () => {
    render(<BulkCurriculumTemplateInstall />);
    fireEvent.click(screen.getByText("Install saved curriculum activities"));
    fireEvent.click(screen.getByLabelText(/Use provisional grouping\/spacing/));
    expect(screen.getByText(/2 provisional placements/)).toBeTruthy();
    const action = screen.getByRole("button", { name: "Install 3 and revise 0" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I reviewed the 2 provisional placements/));
    expect(action.disabled).toBe(false);
    fireEvent.click(action);
    await waitFor(() => expect(useStore.getState().tracker).toHaveLength(3));
    expect(useStore.getState().tracker.filter((row) => row.weekSource === "inferred")).toHaveLength(2);
    expect(useStore.getState().tracker.filter((row) => row.weekSource === "template")).toHaveLength(1);
  });

  it("revises a source title but never deletes an existing learner-chosen week or study notes", async () => {
    const older = { id: "studied", path: "Term 2/NB2/Week 9",
      label: "NB Lecture 01 Old title", templateKey: "nb2|lecture|1",
      activity: "lecture" as const, kind: "Lecture" as const,
      passes: 5, ankiPasses: 2, note: "Persistent learner note", yield: "high" as const,
      weekSource: "learner" as const, updated: "2026-09-14T12:00:00Z" };
    useStore.setState({ tracker: [older], documents: [lecture] });
    render(<BulkCurriculumTemplateInstall />);
    fireEvent.click(screen.getByText("Install saved curriculum activities"));
    expect(screen.getByRole("button", { name: "Install 0 and revise 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install 0 and revise 1" }));
    await waitFor(() => expect(useStore.getState().tracker[0]?.label).toBe("NB Lecture 01 Synaptic Transmission"));
    expect(useStore.getState().tracker).toEqual([{ ...older,
      path: "Term 2/BPM 501/NB2/Week 9",
      label: "NB Lecture 01 Synaptic Transmission",
    }]);
  });


  it("allows opting into the T1–T5 outline without inventing missing T4/T5 academic activities", async () => {
    useStore.setState({ documents: [lecture] });
    render(<BulkCurriculumTemplateInstall />);
    fireEvent.click(screen.getByText("Install saved curriculum activities"));
    fireEvent.click(screen.getByLabelText(/Also create the missing Term 1–5 course\/module outline shells/));
    expect(screen.getByText(/23 school-outline module containers/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install 1 and revise 0 + outline" }));
    await waitFor(() => expect(useStore.getState().courses.flatMap((c) => c.modules)).toHaveLength(23));
    const stored = useStore.getState();
    expect(stored.terms.map((term) => term.name)).toEqual([
      "Term 2", "Term 1", "Term 3", "Term 4", "Term 5",
    ]);
    expect(stored.tracker).toHaveLength(1);
    expect(stored.tracker[0].path).toBe("Term 2/BPM 501/NB2/Unscheduled");
    expect(stored.courses.filter((course) =>
      ["PPM 500", "PPM 501"].includes(course.code))).toHaveLength(2);
    const held = stored.terms.filter((term) => ["Term 4", "Term 5"].includes(term.name));
    expect(stored.tracker.filter((item) => held.some((term) => item.path.startsWith(term.name + "/")))).toHaveLength(0);
  });

  it("offers explicit empty outline setup without inventing any schedule or silently writing user data", async () => {
    useStore.setState({ documents: [] });
    render(<BulkCurriculumTemplateInstall />);
    expect(screen.getByText("Set up SGU course outline")).toBeTruthy();
    expect(useStore.getState().tracker).toHaveLength(0);
    expect(useStore.getState().courses).toHaveLength(0);
    // No templates means no learning activities may be installed. A structural
    // navigation shell can still be added, but only with affirmative consent.
    fireEvent.click(screen.getByText("Set up SGU course outline"));
    expect(screen.getByText(/No academic activity templates are saved on this device/)).toBeTruthy();
    const inactive = screen.getByRole("button", { name: "Already represented" }) as HTMLButtonElement;
    expect(inactive.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Also create the missing Term 1–5 course\/module outline shells/));
    expect(useStore.getState().tracker).toHaveLength(0);
    const action = screen.getByRole("button", { name: "Add 23 outline modules" });
    fireEvent.click(action);
    await waitFor(() => expect(useStore.getState().courses.flatMap((course) => course.modules)).toHaveLength(23));
    expect(useStore.getState().tracker).toHaveLength(0);
    expect(useStore.getState().questionSets).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toMatch(/not a cloud upload/i);
  });
});
