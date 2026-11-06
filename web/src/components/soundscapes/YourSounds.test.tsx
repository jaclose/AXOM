// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUserSounds } from "../../lib/soundscapes/presets";
import { useSoundscape } from "../../lib/soundscapes/store";
import { useUserMedia } from "../../lib/soundscapes/userMedia";
import { YourSounds } from "./YourSounds";

const initialPlayer = useSoundscape.getState();
const initialMedia = useUserMedia.getState();
beforeEach(() => { useSoundscape.setState(initialPlayer); useUserMedia.setState(initialMedia); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); applyUserSounds([]); useSoundscape.setState(initialPlayer); useUserMedia.setState(initialMedia); });

describe("Your sounds actions", () => {
  it("preserves the playing main sound if local deletion fails", async () => {
    const item = { id: "a", kind: "sound" as const, name: "Study", mime: "audio/mpeg", size: 64, addedAt: "2026-01-01", presetId: "yours" };
    const stop = vi.fn().mockResolvedValue(undefined);
    useUserMedia.setState({ items: [item], urls: { a: "blob:a" }, remove: vi.fn().mockRejectedValue(new Error("blocked")) });
    useSoundscape.setState({ mainSound: { presetId: "yours", versionId: "user-a" }, presetId: "yours", status: "playing", loadedVersionId: "user-a", versions: { yours: "user-a" }, stop });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<YourSounds />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Study" }));
    await waitFor(() => expect(useUserMedia.getState().remove).toHaveBeenCalledWith("a"));
    expect(useUserMedia.getState().items).toEqual([item]);
    expect(useSoundscape.getState().mainSound).toEqual({ presetId: "yours", versionId: "user-a" });
    expect(stop).not.toHaveBeenCalled();
  });

  it.each([
    { removed: "Chosen", id: "b", stops: false },
    { removed: "Loaded", id: "a", stops: true },
  ])("only stops when the removed file is actually loaded: $removed", async ({ removed, id, stops }) => {
    const items = ["a", "b"].map((key) => ({ id: key, kind: "sound" as const, name: key === "a" ? "Loaded" : "Chosen", mime: "audio/mpeg", size: 64, addedAt: "2026-01-01", presetId: "yours" }));
    const stop = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    useUserMedia.setState({ items, urls: { a: "blob:a", b: "blob:b" }, remove });
    useSoundscape.setState({ mainSound: { presetId: "axom-1", versionId: "axom-soundscape-1" }, presetId: "yours", status: "paused", loadedVersionId: "user-a", versions: { yours: "user-b" }, stop });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<YourSounds />);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${removed}` }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(id));
    await waitFor(() => expect(stop.mock.calls.length).toBe(stops ? 1 : 0));
  });

  it("halts a batch on failure and preserves intent for the first later success", async () => {
    const setMainSound = vi.fn();
    const add = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "ok", kind: "sound", name: "Saved", presetId: "yours" }).mockResolvedValueOnce({ id: "later", kind: "sound", name: "Later", presetId: "yours" });
    useUserMedia.setState({ items: [], urls: {}, add });
    useSoundscape.setState({ mainSound: { presetId: "axom-1", versionId: "axom-soundscape-1" }, setMainSound });
    const { container } = render(<YourSounds />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Make the next added sound/ }));
    const input = container.querySelector('input[type="file"]')!;
    const file = new File(["audio"], "mix.mp3", { type: "audio/mpeg" });
    fireEvent.change(input, { target: { files: [file, file] } });
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(setMainSound).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /Make the next added sound/ }) as HTMLInputElement).checked).toBe(true));
    fireEvent.change(input, { target: { files: [file, file] } });
    await waitFor(() => expect(add).toHaveBeenCalledTimes(3));
    expect(setMainSound).toHaveBeenCalledTimes(1);
    expect(setMainSound).toHaveBeenCalledWith("yours", "user-ok");
  });

  it("clears the make-main intent when the file picker is canceled", async () => {
    const setMainSound = vi.fn();
    const add = vi.fn().mockResolvedValue({ id: "b", kind: "sound", name: "Mix", presetId: "yours" });
    useUserMedia.setState({ items: [], urls: {}, add });
    useSoundscape.setState({ mainSound: { presetId: "axom-1", versionId: "axom-soundscape-1" }, setMainSound });
    const { container } = render(<YourSounds />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Make the next added sound/ }));
    const input = container.querySelector('input[type="file"]')!;
    fireEvent(input, new Event("cancel"));
    expect((screen.getByRole("checkbox", { name: /Make the next added sound/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(input, { target: { files: [new File(["audio"], "mix.mp3", { type: "audio/mpeg" })] } });
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(setMainSound).not.toHaveBeenCalled();
  });

  it("stops a deleted loaded file even if it moved while deletion was pending", async () => {
    const item = { id: "moving", kind: "sound" as const, name: "Moving", mime: "audio/mpeg", size: 64, addedAt: "2026-01-01", presetId: "yours" };
    let finish!: () => void;
    const remove = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = vi.fn().mockResolvedValue(undefined);
    useUserMedia.setState({ items: [item], urls: { moving: "blob:moving" }, remove });
    useSoundscape.setState({ presetId: "yours", status: "playing", loadedVersionId: "user-moving", mainSound: { presetId: "yours", versionId: "user-moving" }, stop });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<YourSounds />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Moving" }));
    act(() => { useSoundscape.setState({ presetId: "alpha-10", mainSound: { presetId: "alpha-10", versionId: "user-moving" } }); });
    await act(async () => { finish(); });
    expect(stop).toHaveBeenCalledOnce();
    expect(useSoundscape.getState().mainSound).toEqual({ presetId: "axom-1", versionId: "axom-soundscape-1" });
  });

  it("keeps AXOM Soundscape 1 available after another main is chosen and it is unpinned", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    useSoundscape.setState({ mainSound: { presetId: "alpha-10", versionId: "ocean" }, pinned: [], play });
    render(<YourSounds />);
    fireEvent.click(screen.getByRole("button", { name: "Play AXOM Soundscape 1" }));
    expect(play).toHaveBeenCalledWith("axom-1", { version: "axom-soundscape-1" });
  });
});
