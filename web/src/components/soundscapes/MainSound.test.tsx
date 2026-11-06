// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUserSounds } from "../../lib/soundscapes/presets";
import { useSoundscape } from "../../lib/soundscapes/store";
import { MainSound } from "./MainSound";

const initial = useSoundscape.getState();
beforeEach(() => useSoundscape.setState(initial));
afterEach(() => { cleanup(); vi.restoreAllMocks(); applyUserSounds([]); useSoundscape.setState(initial); });

describe("Main sound", () => {
  it("plays the selected version when another version on the same shelf is playing", () => {
    applyUserSounds([{ id: "first", name: "First", url: "blob:first", presetId: "yours" }, { id: "second", name: "Second", url: "blob:second", presetId: "yours" }]);
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn().mockResolvedValue(undefined);
    useSoundscape.setState({ mainSound: { presetId: "yours", versionId: "user-first" }, presetId: "yours", versions: { yours: "user-second" }, status: "playing", loadedVersionId: "user-second", play, pause });
    render(<MainSound />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalledWith("yours", { version: "user-first" });
    expect(pause).not.toHaveBeenCalled();
  });

  it("pauses when its exact version is playing", () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    useSoundscape.setState({ mainSound: { presetId: "axom-1", versionId: "axom-soundscape-1" }, presetId: "axom-1", versions: { "axom-1": "axom-soundscape-1" }, status: "playing", loadedVersionId: "axom-soundscape-1", pause });
    render(<MainSound />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(pause).toHaveBeenCalledOnce();
  });

  it("resumes its paused recording without restarting or following another pending choice", () => {
    applyUserSounds([{ id: "first", name: "First", url: "blob:first", presetId: "yours" }, { id: "second", name: "Second", url: "blob:second", presetId: "yours" }]);
    const play = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    useSoundscape.setState({ mainSound: { presetId: "yours", versionId: "user-first" }, presetId: "yours", versions: { yours: "user-second" }, status: "paused", loadedVersionId: "user-first", play, resume });
    render(<MainSound />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(resume).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
    expect(useSoundscape.getState().versions.yours).toBe("user-first");
  });
});
