// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { RevisionSummary } from "../sync/syncTypes";

// Real account-store action and auth subscription; no account service or
// persisted learner bytes. This deliberately exercises pullLatest, NOT the
// separately owned mergeWithAccount/restoreRevision acceptance tests.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((callback: (event: string, session: Session | null) => void) => {
  emitAuth = callback;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const client = {
  auth: { onAuthStateChange },
  from: () => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: null, error: null }),
  }) }) }),
};
vi.mock("./supabase", () => ({
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => client,
  loadSupabase: async () => client,
  readStoredSession: () => null,
}));

const HASH = "b".repeat(64);
const replaceAll = vi.fn();
const workspace = { schemaVersion: 35, replaceAll };
vi.mock("../store", () => ({ useStore: { getState: () => workspace } }));
vi.mock("../sync/workspaceSnapshot", () => ({
  snapshotWorkspace: vi.fn(async () => ({ contentHash: HASH })),
}));
vi.mock("../sync/contentDownloads", () => ({
  retainDownloadedContent: async (payload: unknown) => payload,
}));
vi.mock("../backup", () => ({
  parseImport: (value: string) => JSON.parse(value),
  mergeStates: vi.fn(),
}));
vi.mock("../localBackup", () => ({ createLocalBackup: vi.fn(async () => undefined) }));
vi.mock("../localVault", () => ({
  getVaultWriteCheckpoint: () => 0,
  flushLocalVaultWrites: vi.fn(async () => undefined),
  assertVaultWritesSince: vi.fn(),
}));
vi.mock("../restoreHistory", () => ({ recordRestoreEvent: vi.fn() }));

let syncMeta = {
  accountUserId: "synthetic-a",
  baseRevision: 4,
  lastHash: HASH,
  pending: false,
  conflictServerRevision: undefined as number | undefined,
};
const write = vi.fn((next: Record<string, unknown>) => Object.assign(syncMeta, next));
vi.mock("../sync/syncMetadata", () => ({
  clearAccountSync: vi.fn(),
  deviceId: () => "synthetic-device",
  read: () => syncMeta,
  write,
}));
vi.mock("../sync/syncCoordinator", () => ({
  SyncCoordinator: class {
    flush = vi.fn(async () => undefined);
    currentStatus = () => "protected";
    dispose = vi.fn();
  },
}));

let releaseMedia: (() => void) | undefined;
const prepareMediaCache = vi.fn(() => new Promise<void>((resolve) => {
  releaseMedia = resolve;
}));
const latest: RevisionSummary = {
  id: "synthetic-a-revision-7",
  revision: 7,
  schemaVersion: 35,
  contentHash: HASH,
  reason: "manual",
  createdAt: "2026-11-01T12:00:00Z",
};
const revision = vi.fn(async () => ({
  payload: { syntheticPrivateA: "newer-protected-version" },
  contentHash: HASH,
}));
vi.mock("../sync/supabaseTransport", () => ({
  SupabaseSyncTransport: class {
    summaries = vi.fn(async () => [latest]);
    revision = revision;
    prepareMediaCache = prepareMediaCache;
    prepare = vi.fn(async () => ({ contentHash: HASH }));
    devices = vi.fn(async () => []);
    latestRevision = vi.fn(async () => 7);
  },
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");
function sessionFor(id: string): Session {
  return {
    user: {
      id,
      email: id + "@example.test",
      user_metadata: { display_name: id },
      email_confirmed_at: "2026-11-01T12:00:00Z",
    },
  } as unknown as Session;
}
async function startAuthFeed() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
  expect(emitAuth).toBeTypeOf("function");
}
async function waitUntilMediaPrepare() {
  await vi.waitFor(() => expect(prepareMediaCache).toHaveBeenCalledTimes(1));
  expect(releaseMedia).toBeTypeOf("function");
}

beforeEach(() => {
  resetAccountInitForTests();
  onAuthStateChange.mockClear();
  prepareMediaCache.mockClear();
  revision.mockClear();
  replaceAll.mockClear();
  write.mockClear();
  releaseMedia = undefined;
  emitAuth = undefined;
  syncMeta = {
    accountUserId: "synthetic-a",
    baseRevision: 4,
    lastHash: HASH,
    pending: false,
    conflictServerRevision: undefined,
  };
  localStorage.clear();
  useAccount.setState({
    phase: "signed-in",
    user: { id: "synthetic-a", email: "a@example.test", displayName: "A", emailConfirmed: true },
    link: "linked",
    protection: "protected",
    busy: false,
    applyingRemote: false,
    error: "",
    message: "",
  });
});

describe("pullLatest authentication-generation boundary", () => {
  it("rejects stale A protected bytes after A -> B -> A while media preparation was pending", async () => {
    await startAuthFeed();
    const pending = useAccount.getState().pullLatest();
    await waitUntilMediaPrepare();
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a"));
    releaseMedia!();
    await pending;

    expect(useAccount.getState().user?.id).toBe("synthetic-a");
    expect(replaceAll).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(syncMeta.baseRevision).toBe(4);
  });

  it("permits legitimate newer protected content after same-owner token refresh", async () => {
    await startAuthFeed();
    const pending = useAccount.getState().pullLatest();
    await waitUntilMediaPrepare();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a"));
    releaseMedia!();
    await pending;

    expect(replaceAll).toHaveBeenCalledExactlyOnceWith(
      { syntheticPrivateA: "newer-protected-version" }, "synthetic-a",
    );
    expect(syncMeta.baseRevision).toBe(7);
    expect(useAccount.getState().error).toBe("");
  });
});
