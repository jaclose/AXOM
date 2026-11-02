// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { completeCurriculumMap } from "../../lib/setupPlan";
import { SGU_CURRICULUM } from "../../lib/curricula";
import { SguCourseMapCompletion } from "./SguCourseMapCompletion";

function seedExistingAccount(track: "sgu" | "usmd" = "sgu") {
  const seed = makeSeed();
  useStore.setState({
    profile: { ...seed.profile, educationTrack: track },
    terms: [{ id: "saved-t1", name: "T1" }, { id: "saved-t2", name: "Term 2" }],
    courses: [
      { id: "saved-bpm500", termId: "saved-t1", code: "BPM500", name: "My edited BPM", files: 4,
        modules: [{ id: "saved-ftm", name: "FTM1" }, { id: "saved-bsce", name: "BSCE T1" }] },
      { id: "saved-local", termId: "saved-t2", code: "LOCAL 101", name: "My local course", files: 1,
        modules: [{ id: "saved-local-module", name: "My module" }] },
    ],
    tracker: Array.from({ length: 59 }, (_, index) => ({
      ...seed.tracker[0], id: `saved-row-${index}`, label: `Saved activity ${index}`,
    })),
  });
}

beforeEach(() => { useStore.setState(makeSeed()); });
afterEach(() => { cleanup(); });

it("offers a one-click completion on an existing tracker, then writes exactly once", () => {
  seedExistingAccount();
  const before = useStore.getState();
  let writes = 0;
  const unsubscribe = useStore.subscribe(() => { writes += 1; });
  render(<SguCourseMapCompletion />);
  const prompt = screen.getByRole("region", { name: "Complete SGU course map" });
  expect(within(prompt).getByText("4 terms · 6 courses · 28 modules to add")).toBeTruthy();
  fireEvent.click(within(prompt).getByRole("button", { name: "Complete SGU course map" }));

  const after = useStore.getState();
  expect(screen.queryByRole("region", { name: "Complete SGU course map" })).toBeNull();
  expect(after.terms).toHaveLength(6);
  expect(after.courses).toHaveLength(8);
  expect(after.tracker).toBe(before.tracker);
  expect(after.tracker).toHaveLength(59);
  expect(after.profile).toBe(before.profile);
  expect(after.courses.find(course => course.id === "saved-local")).toBe(before.courses[1]);
  expect(writes).toBe(1);
  expect(completeCurriculumMap(SGU_CURRICULUM)).toEqual({ terms: 0, courses: 0, modules: 0 });
  expect(useStore.getState()).toBe(after);
  expect(writes).toBe(1);
  unsubscribe();
});

it("shows the option to another school's learner without adding SGU data until click", () => {
  seedExistingAccount("usmd");
  const before = useStore.getState();
  render(<SguCourseMapCompletion />);
  expect(screen.getByText(/Use this if you follow SGU's term structure/)).toBeTruthy();
  expect(useStore.getState()).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Complete SGU course map" }));
  expect(useStore.getState().courses).toHaveLength(8);
  expect(useStore.getState().profile.educationTrack).toBe("usmd");
});
