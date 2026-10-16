// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_INFO } from "../../lib/buildInfo";
import { STORAGE_KEYS } from "../../lib/brand";
import { makeSeed } from "../../lib/seed";
import type { StorageMigrationFailure } from "../../lib/storageMigrations";
import type { LocalWorkspaceBackupInspection } from "../../lib/storageRecovery";
import { RecoveryStatusCard } from "./RecoveryStatusCard";

const backupKey = `${STORAGE_KEYS.localBackupPrefix}2026-07-11T10:00:00.000Z`;
const marker: StorageMigrationFailure = {
  fromVersion: 31,
  toVersion: 32,
  backupKey,
  errorMessage: "Upgrade could not finish",
  at: "2026-07-11T10:00:01.000Z",
  build: BUILD_INFO,
};
const inspection: LocalWorkspaceBackupInspection = {
  key: backupKey,
  savedAt: "2026-07-11T10:00:00.000Z",
  oldSchemaVersion: 31,
  snapshotAppVersion: "0.0.0-previous",
  state: makeSeed(),
};

const storageValues = new Map<string, string>();
const storage = {
  get length() { return storageValues.size; },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => { storageValues.delete(key); },
  setItem: (key: string, value: string) => { storageValues.set(key, String(value)); },
};

beforeEach(() => {
  storageValues.clear();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RecoveryStatusCard", () => {
  it("renders only for the canonical unresolved marker", () => {
    const callbacks = {
      onExport: vi.fn(),
      onChoosePortableRestore: vi.fn(),
      onRetry: vi.fn(),
    };
    const view = render(<RecoveryStatusCard marker={null} {...callbacks} />);
    expect(screen.queryByRole("heading", { name: "Workspace recovery" })).toBeNull();

    view.unmount();
    localStorage.setItem(STORAGE_KEYS.migrationFailure, JSON.stringify(marker));
    render(<RecoveryStatusCard verifyBackup={vi.fn().mockResolvedValue(null)} {...callbacks} />);
    expect(screen.getByRole("heading", { name: "Workspace recovery" })).toBeTruthy();
    expect(screen.getByText(/original workspace was left in place and was not deleted/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });

  it("shows version provenance, verifies the snapshot, and invokes each real action adapter", async () => {
    localStorage.setItem(STORAGE_KEYS.lastSeenBuild, JSON.stringify({
      ...BUILD_INFO,
      version: "0.0.0-previous",
      commitSha: "previous",
    }));
    const onExport = vi.fn();
    const onChoosePortableRestore = vi.fn();
    const onRestoreAutomatic = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <RecoveryStatusCard
        marker={marker}
        onExport={onExport}
        onChoosePortableRestore={onChoosePortableRestore}
        onRetry={vi.fn()}
        onRestoreAutomatic={onRestoreAutomatic}
        verifyBackup={vi.fn().mockResolvedValue(inspection)}
      />,
    );

    expect(screen.getByText("Schema v31 · app 0.0.0-previous")).toBeTruthy();
    expect(screen.getByText(`Schema v32 · app ${BUILD_INFO.version}`)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Readable workspace snapshot")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /export current workspace/i }));
    expect(onExport).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /choose backup file/i }));
    expect(onChoosePortableRestore).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /restore safety snapshot/i }));
    expect(onRestoreAutomatic).toHaveBeenCalledWith(backupKey);
    expect(screen.getByRole("heading", { name: "Workspace recovery" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/retry startup/i);
  });

  it("keeps an unresolved failure visible and disappears only after a successful retry", async () => {
    const onRetry = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(
      <RecoveryStatusCard
        marker={marker}
        onExport={vi.fn()}
        onChoosePortableRestore={vi.fn()}
        onRetry={onRetry}
        onResolved={onResolved}
        verifyBackup={vi.fn().mockResolvedValue(inspection)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /retry startup/i }));
    expect(await screen.findByText(/still could not complete/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Workspace recovery" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /retry startup/i }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Workspace recovery" })).toBeNull());
    expect(onResolved).toHaveBeenCalledOnce();
  });

  it("does not enable automatic restore when the snapshot cannot be verified", async () => {
    render(
      <RecoveryStatusCard
        marker={marker}
        onExport={vi.fn()}
        onChoosePortableRestore={vi.fn()}
        onRetry={vi.fn()}
        onRestoreAutomatic={vi.fn()}
        verifyBackup={vi.fn().mockResolvedValue(null)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Snapshot could not be verified")).toBeTruthy());
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /restore safety snapshot/i }).disabled).toBe(true);
  });

  it("does not announce export success when the exporter reports failure", async () => {
    const user = userEvent.setup();
    render(
      <RecoveryStatusCard
        marker={marker}
        onExport={vi.fn().mockResolvedValue(false)}
        onChoosePortableRestore={vi.fn()}
        onRetry={vi.fn()}
        verifyBackup={vi.fn().mockResolvedValue(inspection)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /export current workspace/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/did not finish/i);
    expect(screen.queryByText(/export started/i)).toBeNull();
  });
});
