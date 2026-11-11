// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSeed } from "../seed";
import { SyncCoordinator } from "../sync/syncCoordinator";
import { SyncPushError, classifyPushFailure } from "../sync/syncFailure";
import { read as readSyncMetadata, SYNC_METADATA_KEY } from "../sync/syncMetadata";
import type { SyncTransport } from "../sync/syncTypes";

// This fixture runs the real account-store syncNow action against a REAL
// SyncCoordinator. Unlike the companion R36 mock (which throws from flush),
// a genuine transport failure is caught inside upload() and flush() resolves.
// All accounts, revisions and workspace bytes here are synthetic.
const client = {
  auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
};
vi.mock("./supabase", () => ({
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => client,
  loadSupabase: async () => client,
  readStoredSession: () => null,
}));

let workspace = makeSeed();
vi.mock("../store", () => ({ useStore: { getState: () => workspace } }));
// Preserve the production portable serializer: SyncCoordinator's snapshot
// preflight uses it before invoking the synthetic transport.
vi.mock("../backup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../backup")>()),
  parseImport: (json: string) => JSON.parse(json),
  mergeStates: vi.fn(),
}));
vi.mock("../sync/contentDownloads", () => ({
  retainDownloadedContent: async (payload: unknown) => payload,
}));
vi.mock("../localBackup", () => ({ createLocalBackup: vi.fn(async () => undefined) }));
vi.mock("../localVault", () => ({
  getVaultWriteCheckpoint: () => 0,
  flushLocalVaultWrites: vi.fn(async () => undefined),
  assertVaultWritesSince: vi.fn(),
}));
vi.mock("../restoreHistory", () => ({ recordRestoreEvent: vi.fn() }));
vi.mock("../sync/supabaseTransport", () => ({
  SupabaseSyncTransport: class {
    summaries = vi.fn(async () => []);
    devices = vi.fn(async () => []);
  },
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");

let liveCoordinator: SyncCoordinator | undefined;
let sequence = 0;
const priorReceipt = "2026-11-01T10:00:00.000Z";

function attachActualCoordinator(push: SyncTransport["push"]): void {
  const transport = { push, history: vi.fn(async () => []), revision: vi.fn() } as unknown as SyncTransport;
  liveCoordinator = new SyncCoordinator(transport, () => workspace, 60_000, "protected");
  useAccount.getState().attachCoordinator(liveCoordinator);
}

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  sequence = 0;
  workspace = makeSeed();
  const baseCrypto = globalThis.crypto;
  vi.stubGlobal("crypto", {
    subtle: baseCrypto.subtle,
    getRandomValues: baseCrypto.getRandomValues.bind(baseCrypto),
    randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`),
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  localStorage.setItem(SYNC_METADATA_KEY, JSON.stringify({
    deviceId: "synthetic-device", accountUserId: "synthetic-a", baseRevision: 3,
    pending: false, attempt: 0, lastProtectedAt: priorReceipt,
  }));
  useAccount.setState({
    phase: "signed-in", link: "linked",
    user: { id: "synthetic-a", email: "synthetic-a@example.test", displayName: "Synthetic A", emailConfirmed: true },
    protection: "protected", lastProtectedAt: priorReceipt,
    message: "Previously protected", error: "", busy: false,
    refresh: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  useAccount.getState().attachCoordinator(null);
  liveCoordinator?.dispose();
  liveCoordinator = undefined;
  vi.unstubAllGlobals();
});

describe("manual account save receipt against real coordinator transport", () => {
  it("does not announce a new Protected receipt when the real coordinator catches HTTP 500 / SQLSTATE 57014", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockRejectedValue(
      new SyncPushError(classifyPushFailure({ code: "57014", message: "statement timeout" }, 500), "Synthetic timeout"),
    );
    attachActualCoordinator(push);

    await useAccount.getState().syncNow();

    expect(push).toHaveBeenCalledTimes(1);
    expect(useAccount.getState().protection).toBe("retrying");
    expect(useAccount.getState().message).not.toBe("Protected just now.");
    expect(useAccount.getState().syncFailure).toMatchObject({ kind: "server", status: 500, code: "57014" });
    expect(readSyncMetadata()).toMatchObject({ pending: true, baseRevision: 3 });
    expect(readSyncMetadata().lastProtectedAt).toBe(priorReceipt);
  });

  it("keeps a failed permission response distinct from an earlier successful protection", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockRejectedValue(
      new SyncPushError(classifyPushFailure({ message: "Access denied" }, 403), "Synthetic 403"),
    );
    attachActualCoordinator(push);

    await useAccount.getState().syncNow();

    expect(push).toHaveBeenCalledTimes(1);
    expect(useAccount.getState().protection).not.toBe("protected");
    expect(useAccount.getState().message).not.toBe("Protected just now.");
    expect(readSyncMetadata().pending).toBe(true);
  });

  it("announces Protected just now only after an actual accepted revision", async () => {
    const push = vi.fn<SyncTransport["push"]>().mockResolvedValue({
      status: "accepted", revision: 4, revisionId: "synthetic-r4", idempotent: false,
    });
    attachActualCoordinator(push);

    await useAccount.getState().syncNow();

    // If the positive control never reaches transport, report whether a local
    // preflight rejection was swallowed by the real coordinator.
    expect(readSyncMetadata().lastError?.rejection).not.toBe("preparation-failed");
    expect(push).toHaveBeenCalledTimes(1);
    expect(useAccount.getState().protection).toBe("protected");
    expect(useAccount.getState().message).toBe("Protected just now.");
    expect(readSyncMetadata()).toMatchObject({ baseRevision: 4, pending: false });
  });
});
