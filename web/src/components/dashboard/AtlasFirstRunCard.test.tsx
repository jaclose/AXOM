// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../../lib/store";
import { useAccount } from "../../lib/account/accountStore";
import { adaptLegacyDashboardLayout } from "../../lib/dashboardWidgets";
import { confirmAtlasCompanion } from "../../lib/communications/passiveFirstRunClient";
import { AtlasFirstRunCard } from "./AtlasFirstRunCard";

const fixture = () => adaptLegacyDashboardLayout({
  order: ["welcome", "commandBrief", "tasks", "courseTracker", "questionBank", "pomodoro"],
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAccount.setState({ user: null, phase: "signed-out" });
  useStore.setState(state => ({ profile: { ...state.profile, dashboardLayout: fixture() } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Atlas companion is useful only when learners accept its actions", () => {
  it("provides an actionable academic guide and live dashboard improvement with guarded Undo", () => {
    expect(confirmAtlasCompanion("fathom", Date.now(), null, "question-bank")).toBe(true);
    render(<AtlasFirstRunCard />);
    expect(screen.getByRole("link", { name: "Open Question Bank" }).getAttribute("href")).toBe("#questions");
    const before = useStore.getState().profile.dashboardLayout!;
    expect(before.order[2]).toBe("tasks");
    fireEvent.click(screen.getByRole("button", { name: "Apply dashboard suggestion" }));
    expect(useStore.getState().profile.dashboardLayout?.order[2]).toBe("questionBank");
    expect(screen.getByRole("button", { name: "Undo dashboard change" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo dashboard change" }));
    expect(useStore.getState().profile.dashboardLayout?.order).toEqual(before.order);
    expect(useStore.getState().profile.dashboardLayout?.hiddenWidgetIds).toEqual(before.hiddenWidgetIds);
  });

  it("preserves a learner-hidden Question Bank instead of forcing it back", () => {
    const previous = fixture();
    previous.hiddenWidgetIds = ["questionBank"];
    useStore.setState(state => ({ profile: { ...state.profile, dashboardLayout: previous } }));
    confirmAtlasCompanion("fathom", Date.now(), null, "question-bank");
    render(<AtlasFirstRunCard />);
    expect(screen.queryByRole("button", { name: "Apply dashboard suggestion" })).toBeNull();
    expect(screen.getByText(/previously hid or removed Question Bank/i)).toBeTruthy();
    expect(useStore.getState().profile.dashboardLayout?.hiddenWidgetIds).toContain("questionBank");
  });

  it("never overwrites a newer manual dashboard edit when Undo is clicked", () => {
    confirmAtlasCompanion("fathom", Date.now(), null, "question-bank");
    render(<AtlasFirstRunCard />);
    fireEvent.click(screen.getByRole("button", { name: "Apply dashboard suggestion" }));
    const applied = useStore.getState().profile.dashboardLayout!;
    useStore.setState(state => ({
      profile: { ...state.profile, dashboardLayout: { ...applied, hiddenWidgetIds: ["questionBank"] } },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Undo dashboard change" }));
    expect(useStore.getState().profile.dashboardLayout?.hiddenWidgetIds).toContain("questionBank");
    expect(screen.getByRole("status").textContent).toMatch(/newer dashboard changes/i);
  });

  it("does not alter private academic content, targets or email preferences when applying a layout", () => {
    confirmAtlasCompanion("juniper", Date.now(), null, "course-tracker");
    const before = useStore.getState();
    const courses = before.courses;
    const questions = before.questions;
    const targets = before.profile.dailySuccess;
    render(<AtlasFirstRunCard />);
    fireEvent.click(screen.getByRole("button", { name: "Apply dashboard suggestion" }));
    expect(useStore.getState().courses).toBe(courses);
    expect(useStore.getState().questions).toBe(questions);
    expect(useStore.getState().profile.dailySuccess).toBe(targets);
  });
});
