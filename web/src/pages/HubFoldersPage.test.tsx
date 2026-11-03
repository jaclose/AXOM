// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { HubFoldersPage, filterFolders } from "./HubFoldersPage";

beforeEach(() => {
  const seed = makeSeed();
  seed.folders = [
    { id: "a", name: "Cardio lectures", group: "Term 4", tags: ["cardio"], localPath: "/Users/me/Cardio", sortOrder: 0 },
    { id: "b", name: "UWorld", group: "Boards", link: "https://www.uworld.com", favorite: true, sortOrder: 1 },
    { id: "c", name: "Renal", group: "Term 4", sortOrder: 2 },
  ];
  useStore.setState(seed);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Hub Folders", () => {
  it("filters by text, group, and favorites", () => {
    const folders = useStore.getState().folders;
    expect(filterFolders(folders, "cardio", null, false).map((folder) => folder.id)).toEqual(["a"]);
    expect(filterFolders(folders, "", "Term 4", false).map((folder) => folder.id)).toEqual(["a", "c"]);
    expect(filterFolders(folders, "", null, true).map((folder) => folder.id)).toEqual(["b"]);
  });

  it("pins favorites, groups the rest, and copies local paths (browsers cannot open them)", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<HubFoldersPage />);
    expect(screen.getByRole("region", { name: "Pinned folders" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Term 4 folders" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy path for Cardio lectures" }));
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("/Users/me/Cardio");
    expect(useStore.getState().folders.find((folder) => folder.id === "a")?.lastOpenedAt).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search folders"), { target: { value: "renal" } });
    expect(screen.queryByText("Cardio lectures")).toBeNull();
    expect(screen.getByText("Renal")).toBeTruthy();
  });

  it("opens only safe recent web links and keeps unsafe saved links out of quick launch", () => {
    const folders = useStore.getState().folders.map((folder) => folder.id === "b"
      ? { ...folder, link: "www.uworld.com", lastOpenedAt: "2026-11-02T05:00:00.000Z" }
      : folder);
    folders.push({ id: "unsafe", name: "Unsafe destination", link: "javascript:alert(1)", lastOpenedAt: "2026-11-02T05:01:00.000Z" });
    useStore.setState({ folders });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(<HubFoldersPage />);
    const recent = container.querySelector(".folders-recent") as HTMLElement;
    expect(within(recent).queryByRole("button", { name: "Unsafe destination" })).toBeNull();
    fireEvent.click(within(recent).getByRole("button", { name: "UWorld" }));
    expect(open).toHaveBeenCalledWith("https://www.uworld.com/", "_blank", "noopener");
  });
});
