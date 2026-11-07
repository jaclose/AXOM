// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { SetupFlow } from "./SetupFlow";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  const seed = makeSeed();
  seed.profile.onboarded = false;
  seed.profile.tourDone = undefined;
  useStore.setState(seed);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }));
const tool = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("SetupFlow", () => {
  it("offers the other hosted workspace without leaving or changing apex work", () => {
    vi.stubGlobal("location", { hostname: "axom.info" });
    render(<SetupFlow mode="first-run" />);
    const link = screen.getByRole("link", { name: /Open www\.axom\.info/ });
    expect(link.getAttribute("href")).toBe("https://www.axom.info/?app=1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/Work stored here does not move/)).toBeTruthy();
  });

  it("walks three screens, starting in the name field, and builds SGU with Anki by default", () => {
    const onComplete = vi.fn();
    render(<SetupFlow mode="first-run" onComplete={onComplete} />);

    expect(screen.getByRole("heading", { name: "Who are you studying as?" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("What should we call you?"));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("What should we call you?"), { target: { value: "Ada" } });
    next();
    expect(screen.getByRole("heading", { name: "What do you use?" })).toBeTruthy();
    next();
    expect(screen.getByRole("heading", { name: "Make it yours." })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Accent palette" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enter AXOM" }));

    const state = useStore.getState();
    expect(onComplete).toHaveBeenCalledWith("dashboard");
    expect(state.profile).toMatchObject({ name: "Ada", onboarded: true, tourDone: true });
    expect(state.terms.map((term) => term.name)).toEqual(["Term 1", "Term 2", "Term 3", "Term 4", "Term 5", "Boards"]);
    expect(state.tracker.some((row) => /^example/i.test(row.label))).toBe(false);
    expect(state.profile.dailySuccess?.requirements.map((requirement) => requirement.label)).toContain("Anki cards");
    expect(localStorage.getItem("axom.setup.v2")).toBeNull();
  });

  it("does not enable passive observation unless the learner explicitly opts in", () => {
    render(<SetupFlow mode="first-run" />);
    next(); next();
    const toggle = screen.getByRole("switch", { name: "Allow on-device first-run Atlas suggestions" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Enter AXOM" }));
    expect(sessionStorage.getItem("axom.atlas.first-run-session.v1")).toBeNull();
  });

  it("counts only changed study preferences when the optional first-run signal is enabled", () => {
    render(<SetupFlow mode="first-run" />);
    fireEvent.change(screen.getByLabelText("What should we call you?"), { target: { value: "Private Learner" } });
    next();
    fireEvent.click(tool("Anki"));
    next();
    const toggle = screen.getByRole("switch", { name: "Allow on-device first-run Atlas suggestions" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Enter AXOM" }));
    const raw = sessionStorage.getItem("axom.atlas.first-run-session.v1") ?? "";
    expect(raw).toContain('"tools"');
    expect(raw).not.toContain("Private Learner");
    expect(raw).not.toContain("journal");
    expect(raw).not.toContain("clickstream");
  });

  it("starts a non-SGU student clean, and a no-flashcards routine gets no card target", () => {
    render(<SetupFlow mode="first-run" />);
    fireEvent.click(screen.getByRole("radio", { name: /US MD/ }));
    expect(screen.queryByRole("radio", { name: "Term 1" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Clinical" }));
    expect(screen.getAllByText("A clean slate you shape with your own courses").length).toBeGreaterThan(0);
    next();
    fireEvent.click(tool("Anki"));
    expect(tool("Anki").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByText(/No flashcard rounds/).length).toBeGreaterThan(0);
    next();
    fireEvent.click(screen.getByRole("button", { name: "Enter AXOM" }));

    const { profile, terms, courses } = useStore.getState();
    expect(terms).toEqual([]);
    expect(courses).toEqual([]);
    expect(profile.academicStageId).toBe("clinical-rotations");
    expect(profile.studyWorkflow?.methods?.find((method) => method.id === "anki")?.enabled).toBe(false);
    expect(profile.dailySuccess?.requirements.some((requirement) => requirement.source.kind === "cards-reviewed")).toBe(false);
  });

  it("resumes the same screen after a refresh, and Back keeps what was typed", () => {
    const { unmount } = render(<SetupFlow mode="first-run" />);
    fireEvent.change(screen.getByLabelText("What should we call you?"), { target: { value: "Grace" } });
    next();
    fireEvent.click(tool("Noji"));
    unmount();

    render(<SetupFlow mode="first-run" />);
    expect(screen.getByRole("heading", { name: "What do you use?" })).toBeTruthy();
    expect(tool("Noji").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("What should we call you?") as HTMLInputElement).value).toBe("Grace");
  });

  it("skipping still leaves a working AXOM from the defaults", () => {
    const onComplete = vi.fn();
    render(<SetupFlow mode="first-run" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onComplete).toHaveBeenCalledWith("dashboard");
    expect(useStore.getState().profile).toMatchObject({ onboarded: true, tourDone: true });
  });

  it("a rerun never rebuilds courses or targets, and Cancel changes nothing", () => {
    useStore.getState().updateProfile({ onboarded: true, tourDone: true, name: "Lin" });
    const before = useStore.getState();
    const onCancel = vi.fn();
    const { unmount } = render(<SetupFlow mode="rerun" onCancel={onCancel} />);
    expect(screen.getByText("Update your setup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(useStore.getState().profile).toEqual(before.profile);
    unmount();

    render(<SetupFlow mode="rerun" />);
    fireEvent.click(screen.getByRole("radio", { name: /Pre-med/ }));
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const after = useStore.getState();
    expect(after.courses).toBe(before.courses);
    expect(after.terms).toBe(before.terms);
    expect(after.profile.dailySuccess).toEqual(before.profile.dailySuccess);
  });

  it("never resumes a first-run draft inside a later rerun", () => {
    const { unmount } = render(<SetupFlow mode="first-run" />);
    next();
    unmount();
    useStore.getState().updateProfile({ onboarded: true });
    render(<SetupFlow mode="rerun" />);
    expect(screen.getByRole("heading", { name: "Who are you studying as?" })).toBeTruthy();
  });
});
