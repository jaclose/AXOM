// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../../lib/seed";
import { useStore } from "../../lib/store";
import { markVaultWrite, markVaultWriteFailure } from "../../lib/vaultActivity";
import { DataHealthPanel } from "./DataHealthPanel";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  useStore.setState(makeSeed());
  markVaultWrite("indexeddb", new Date("2026-11-01T12:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  markVaultWrite("indexeddb");
  vi.unstubAllGlobals();
});

describe("Data health trust surface", () => {
  it("shows a confirmed local save and keeps technical metrics behind disclosure", async () => {
    render(<DataHealthPanel />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Saved on this device" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Your saved work" })).toBeTruthy();
    expect(document.querySelectorAll(".data-health-cell")).toHaveLength(8);
    expect(screen.getByText("Technical details").closest("details")?.open).toBe(false);
  });

  it("puts retry and recovery next to a failed save", () => {
    markVaultWriteFailure(new Date("2026-11-01T12:01:00.000Z"));
    const onOpenBackup = vi.fn();
    render(<DataHealthPanel onOpenBackup={onOpenBackup} />);
    expect(screen.getByRole("heading", { name: "Your latest changes need saving" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try saving again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Emergency recovery" }));
    expect(onOpenBackup).toHaveBeenCalledOnce();
  });
});
