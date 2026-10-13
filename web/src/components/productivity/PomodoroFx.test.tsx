// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { usePomodoro } from "../../lib/pomodoro";
import { useStore } from "../../lib/store";
import { useToasts } from "../../lib/toast";
import { PomodoroFx } from "./PomodoroFx";

vi.mock("../../lib/notify", () => ({ notify: vi.fn() }));

beforeEach(() => {
  const seed = makeSeed();
  seed.tracker = [{ id: "lecture-1", path: "Term 4/NCRS", label: "Cranial nerves", kind: "Lecture", passes: 0, ankiPasses: 0, yield: "none", updated: "2026-10-13T10:00:00.000Z" }];
  useStore.setState(seed);
  useToasts.setState({ toasts: [] });
  usePomodoro.setState({ completedAt: null, completedMinutes: 0, targetKind: "tracker", targetId: "lecture-1", targetLabel: "Cranial nerves" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Pomodoro course completion", () => {
  it("asks before recording a targeted pass and records an event once", () => {
    render(<PomodoroFx />);
    act(() => usePomodoro.setState({ completedAt: "2026-10-13T12:00:00.000Z", completedMinutes: 25 }));
    const toast = useToasts.getState().toasts[0];
    expect(toast).toMatchObject({ title: "Focus sprint complete", duration: 0 });
    const action = toast.actions?.find((candidate) => candidate.label === "Question round");
    act(() => action?.onAction?.());
    act(() => action?.onAction?.());
    expect(useStore.getState().tracker[0]).toMatchObject({
      passes: 1,
      passEvents: [{ id: "pomodoro-course:2026-10-13T12:00:00.000Z", method: "questions" }],
    });
  });
});
