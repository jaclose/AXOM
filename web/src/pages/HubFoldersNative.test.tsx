// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeSeed } from "../lib/seed";
import { useStore } from "../lib/store";
import { HubFoldersPage } from "./HubFoldersPage";

const native = vi.hoisted(() => ({ info: vi.fn(), open: vi.fn() }));
vi.mock("../lib/desktopShell", async (original) => ({ ...await original<object>(), isTauriShell: () => true }));
vi.mock("../lib/hubFolders", async (original) => ({ ...await original<object>(), hubFolderInfo: native.info, openHubFolder: native.open }));

beforeEach(() => {
  localStorage.clear();
  native.info.mockReset().mockResolvedValue({ entries: 2, entriesCapped: false });
  native.open.mockReset().mockResolvedValue(undefined);
  useStore.setState({ ...makeSeed(), folders: [{ id: "qa", name: "Study QA", localPath: "/tmp/original" }] });
});
afterEach(cleanup);

it("does not display directory metadata after its destination changes", async () => {
  render(<HubFoldersPage />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh details for Study QA" }));
  await screen.findByText("2 items");
  await act(async () => { useStore.getState().updateFolder("qa", { localPath: "/tmp/new-folder" }); });
  expect(screen.queryByText("2 items")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Study QA in file manager" }));
  await waitFor(() => expect(native.open).toHaveBeenCalledWith("/tmp/new-folder", false));
});

it("shows a native failure and allows a safe retry", async () => {
  native.open.mockRejectedValueOnce(new Error("This folder is missing or inaccessible on this device."));
  render(<HubFoldersPage />);
  fireEvent.click(screen.getByRole("button", { name: "Open Study QA in file manager" }));
  expect((await screen.findByRole("alert")).textContent).toContain("missing or inaccessible");
  fireEvent.click(screen.getByRole("button", { name: "Open Study QA in file manager" }));
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("does not keep a missing-folder error after changing its destination", async () => {
  native.open.mockRejectedValueOnce(new Error("This folder is missing or inaccessible on this device."));
  render(<HubFoldersPage />);
  fireEvent.click(screen.getByRole("button", { name: "Open Study QA in file manager" }));
  await screen.findByRole("alert");
  await act(async () => { useStore.getState().updateFolder("qa", { localPath: "/tmp/new-folder" }); });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Study QA in file manager" }));
  await waitFor(() => expect(native.open).toHaveBeenLastCalledWith("/tmp/new-folder", false));
});
