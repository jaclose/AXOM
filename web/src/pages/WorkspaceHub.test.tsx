// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyWorkspacePage } from "./DailyWorkspacePage";
import { StudyStudioPage } from "./StudyStudioPage";
import { LibraryWorkspacePage } from "./LibraryWorkspacePage";

vi.mock("./ProductivityPage", () => ({ ProductivityPage: () => <div>Focus activity logger</div> }));
vi.mock("./TasksPage", () => ({ TasksPage: () => <div>Task register</div> }));
vi.mock("./HabitTrackerPage", () => ({ HabitTrackerPage: () => <div>Habit register</div> }));
vi.mock("./StudyMethodsPage", () => ({ StudyMethodsPage: () => <div>Method recommender</div> }));
vi.mock("./PromptLibraryPage", () => ({ PromptLibraryPage: () => <div>Prompt collection</div> }));
vi.mock("./ResourcesPage", () => ({ ResourcesPage: () => <div>Source catalog</div> }));
vi.mock("./HubFoldersPage", () => ({ HubFoldersPage: () => <div>Folder shortcuts</div> }));
vi.mock("../lib/store", () => ({
  useStore: () => ({
    activeDayKey: "2026-11-07",
    tasks: [{ id: "t1", done: false, archived: false, due: "2026-11-06" }],
    habits: [{ id: "h1", archived: false }],
    prompts: [{ id: "p1" }],
    resources: [{ id: "r1" }],
    folders: [{ id: "f1", archived: false }],
    profile: { experimentalFlags: { habits: true } },
  }),
}));

afterEach(cleanup);

describe("consolidated workspaces", () => {
  it("keeps focus, tasks, and habit actions under a single day surface", () => {
    render(<DailyWorkspacePage />);
    expect(screen.getByText("Focus activity logger")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tasks/ }));
    expect(screen.getByText("Task register")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Habits/ }));
    expect(screen.getByText("Habit register")).toBeTruthy();
  });

  it("honors legacy task deep links without changing persisted task data", () => {
    render(<DailyWorkspacePage initialTab="tasks" />);
    expect(screen.getByText("Task register")).toBeTruthy();
  });

  it("combines method recommendations with saved prompts", () => {
    render(<StudyStudioPage />);
    expect(screen.getByText("Method recommender")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Prompts/ }));
    expect(screen.getByText("Prompt collection")).toBeTruthy();
  });

  it("combines source links with existing folder shortcuts", () => {
    render(<LibraryWorkspacePage />);
    expect(screen.getByText("Source catalog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Folders/ }));
    expect(screen.getByText("Folder shortcuts")).toBeTruthy();
  });
});
