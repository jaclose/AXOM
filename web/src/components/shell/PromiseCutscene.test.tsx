// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROMISE_MOVEMENTS } from "../../lib/promiseText";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { PromiseCutscene, SavedPromise } from "./PromiseCutscene";

beforeEach(() => {
  useStore.setState(makeSeed());
  useStore.getState().updateProfile({ name: "Ada" });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const toSigning = () => {
  for (let index = 0; index < PROMISE_MOVEMENTS.length - 1; index += 1) fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign it" }));
};

describe("PromiseCutscene", () => {
  it("reads in three movements the student advances, with Review later always one step away", () => {
    const onDone = vi.fn();
    render(<PromiseCutscene onDone={onDone} />);
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "The tool" })).toBeTruthy();
    expect(screen.getByText("This is only a tool.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Promise progress" }).querySelector('[aria-current="step"]')?.textContent).toBe("The tool");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("region", { name: "The return" })).toBeTruthy();
    expect(document.activeElement?.textContent).toContain("if you record the work,");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("can skip straight to signing, and keeps focus inside the sequence", () => {
    render(<PromiseCutscene onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip to signing" }));
    expect(screen.getByRole("heading", { name: "What I am promising" })).toBeTruthy();
    const name = screen.getByLabelText("Sign with your name") as HTMLInputElement;
    expect(name.value).toBe("Ada");
    const later = screen.getByRole("button", { name: "Review later" });
    const sign = screen.getByRole("button", { name: "Sign the promise" });
    sign.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(later);
  });

  it("signs once, writes the first journal entry, then fades into AXOM", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<PromiseCutscene onDone={onDone} />);
    toSigning();
    const name = screen.getByLabelText("Sign with your name");
    fireEvent.change(name, { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Sign the promise" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: "Ada Lovelace" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign the promise" }));

    const { profile, journal } = useStore.getState();
    expect(profile.promise).toMatchObject({ signedName: "Ada Lovelace", promiseTextVersion: "promise-of-use-v1" });
    expect(journal.at(-1)?.rating).toBe("Promise");
    expect(screen.getByRole("status").textContent).toContain("Promise made.");
    expect(screen.queryByRole("button", { name: "Review later" })).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("clears its timers when it unmounts early", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const view = render(<PromiseCutscene onDone={onDone} />);
    toSigning();
    fireEvent.click(screen.getByRole("button", { name: "Sign the promise" }));
    view.unmount();
    vi.runAllTimers();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("SavedPromise", () => {
  it("shows the signed name and closes on Escape without reaching the dialog underneath", () => {
    useStore.getState().updateProfile({ promise: { signedName: "Ada", signedAt: "2026-09-30T12:00:00.000Z", promiseTextVersion: "promise-of-use-v1" } });
    const onClose = vi.fn();
    const underneath = vi.fn();
    document.addEventListener("keydown", underneath);
    render(<SavedPromise onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "A promise to yourself" })).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(underneath).not.toHaveBeenCalled();
    document.removeEventListener("keydown", underneath);
  });
});
