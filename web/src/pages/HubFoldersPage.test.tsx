// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
