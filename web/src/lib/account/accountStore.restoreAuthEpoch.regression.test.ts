// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { RevisionSummary } from "../sync/syncTypes";

// Exercise the actual Zustand restoreRevision action, not a copied implementation.
// Only the transport, browser vault, and SDK auth feed are synthetic. In particular,
// the account A -> B -> A transition must travel through the real SDK callback.
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const client = {
  auth: { onAuthStateChange },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
};
vi.mock("./supabase", () => ({
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => client,
  loadSupabase: async () => client,
  readStoredSession: () => null,
}));

const replaceAll = vi.fn();
const workspace = { schemaVersion: 35, replaceAll };
vi.mock("../store", () => ({ useStore: { getState: () => workspace } }));
vi.mock("../backup", () => ({
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
vi.mock("../sync/syncMetadata", () => ({
  clearAccountSync: vi.fn(),
  deviceId: () => "synthetic-device",
  read: () => ({ accountUserId: "synthetic-a", baseRevision: 4 }),
  write: vi.fn(),
}));
vi.mock("../sync/syncCoordinator", () => ({
  SyncCoordinator: class {
    flush = vi.fn(async () => undefined);
    currentStatus = () => "protected";
    dispose = vi.fn();
  },
}));

let releaseMedia: (() => void) | undefined;
const prepareMediaCache = vi.fn(() => new Promise<void>((resolve) => { releaseMedia = resolve; }));
const revision = vi.fn(async () => ({
  payload: { syntheticAccountAOnly: "old-session-revision" },
  contentHash: "a".repeat(64),
}));
vi.mock("../sync/supabaseTransport", () => ({
  SupabaseSyncTransport: class {
    revision = revision;
    prepareMediaCache = prepareMediaCache;
    summaries = vi.fn(async () => []);
    devices = vi.fn(async () => []);
    latestRevision = vi.fn(async () => 7);
  },
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");

const syntheticRevision: RevisionSummary = {
  id: "synthetic-a-revision-7", revision: 7, schemaVersion: 35,
  contentHash: "a".repeat(64), reason: "manual", createdAt: "2026-11-01T12:00:00Z",
};
function sessionFor(id: string): Session {
  return { user: { id, email: id + "@example.test", user_metadata: { display_name: id },
    email_confirmed_at: "2026-11-01T12:00:00Z" } } as unknown as Session;
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
  emitAuth = undefined;
  releaseMedia = undefined;
  localStorage.clear();
  useAccount.setState({
    phase: "signed-in",
    user: { id: "synthetic-a", email: "synthetic-a@example.test", displayName: "A", emailConfirmed: true },
    link: "linked", protection: "protected", history: [syntheticRevision], devices: [],
    restoreOffer: undefined, busy: false, error: "", message: "",
  });
});

describe("restoreRevision account-identity generation boundary", () => {
  it("does not replace learner workspace from a pre-switch A request after A -> B -> A", async () => {
    await startAuthFeed();
    const pendingRestore = useAccount.getState().restoreRevision(syntheticRevision);
    await waitUntilMediaPrepare();
    // The original A request is still in flight. The same final account ID
    // is not proof it belongs to the current authenticated session generation.
    emitAuth!("SIGNED_IN", sessionFor("synthetic-b"));
    emitAuth!("SIGNED_IN", sessionFor("synthetic-a"));
    releaseMedia!();
    await pendingRestore;
    expect(useAccount.getState().user?.id).toBe("synthetic-a");
    expect(replaceAll).not.toHaveBeenCalled();
    expect(useAccount.getState().message).not.toMatch(/^Restored\./);
  });

  it("still permits an unchanged-owner restore after a TOKEN_REFRESHED event", async () => {
    await startAuthFeed();
    const pendingRestore = useAccount.getState().restoreRevision(syntheticRevision);
    await waitUntilMediaPrepare();
    emitAuth!("TOKEN_REFRESHED", sessionFor("synthetic-a"));
    releaseMedia!();
    await pendingRestore;
    expect(replaceAll).toHaveBeenCalledTimes(1);
    expect(replaceAll).toHaveBeenCalledWith({ syntheticAccountAOnly: "old-session-revision" }, "synthetic-a");
    expect(useAccount.getState().error).toBe("");
  });
});
