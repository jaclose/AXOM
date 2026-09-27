// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSoundscape } from "../../lib/soundscapes/store";
import { SoundscapeOpener } from "./SoundscapeOpener";

beforeEach(() => {
  localStorage.clear();
  useSoundscape.setState({ taste: { sounds: [], visuals: [] }, pinned: [], lastPresetId: "gamma-40" });
});
afterEach(cleanup);

describe("SoundscapeOpener", () => {
  it("collects sounds then visuals, saves them and leads with the first pick", () => {
    let closed = false;
    render(<SoundscapeOpener onClose={() => { closed = true; }} />);
    expect(screen.getByRole("heading", { name: "What are you into?" })).toBeTruthy();
    expect(screen.getByText(/You can change this anytime/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Rain & waves/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Noise/ }));
    expect(screen.getByRole("checkbox", { name: /Rain & waves/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "What do you like to look at?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Waves/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Random/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    expect(closed).toBe(true);
    const { taste, lastPresetId } = useSoundscape.getState();
    expect(taste).toMatchObject({ sounds: ["water", "noise"], visuals: ["waves", "random"] });
    expect(taste.completedAt).toBeTruthy();
    expect(lastPresetId).toBe("soft-rain");
    expect(JSON.parse(localStorage.getItem("axom.soundscapes.v1")!).taste.sounds).toEqual(["water", "noise"]);
  });

  it("can be skipped without losing earlier picks", () => {
    useSoundscape.setState({ taste: { sounds: ["frequencies"], visuals: [] } });
    render(<SoundscapeOpener onClose={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Noise/ }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(useSoundscape.getState().taste).toMatchObject({ sounds: ["frequencies"] });
    expect(useSoundscape.getState().taste.completedAt).toBeTruthy();
  });
});
