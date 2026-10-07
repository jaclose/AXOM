// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const tables: Record<string, unknown[]> = { workspace_revisions: [], account_devices: [], account_profiles: [], workspaces: [] };

function chain(table: string) {
  const result = () => ({ data: tables[table] ?? [], error: null });
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order", "limit", "upsert", "delete", "update"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  builder.single = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  builder.then = (resolve: (value: unknown) => void) => resolve(result());
  return builder;
}

const session = {
  access_token: "secret-access",
  user: { id: "user-1", email: "learner@example.com", user_metadata: { display_name: "Learner" }, created_at: "2026-09-01T00:00:00Z", email_confirmed_at: "2026-09-01T00:00:00Z" },
};
const auth = {
  getSession: vi.fn(async () => ({ data: { session: null } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithPassword: vi.fn(async () => ({ data: { session }, error: null })),
  signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
  signInWithOtp: vi.fn(async () => ({ error: null })),
  verifyOtp: vi.fn(async () => ({ data: { session }, error: null })),
  signOut: vi.fn(async () => ({ error: null })),
  updateUser: vi.fn(async () => ({ data: { user: session.user }, error: null })),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
};

let storedSession: unknown = null;
let loadFails = false;
vi.mock("./supabase", () => ({
  cloudConfigured: () => true,
  getSupabase: () => ({ auth, rpc, from: (table: string) => chain(table) }),
  loadSupabase: async () => {
    if (loadFails) throw new Error("offline");
    return { auth, rpc, from: (table: string) => chain(table) };
  },
  readStoredSession: () => storedSession,
  authRedirectUrl: () => "http://localhost/",
}));

const { useAccount, validateEmail, validatePassword, resetAccountInitForTests, protectionDetail, protectionLabel, failureSummary } = await import("./accountStore");
const { useStore } = await import("../store");
const { makeSeed } = await import("../seed");

beforeEach(() => {
  localStorage.clear();
  storedSession = null;
  loadFails = false;
  resetAccountInitForTests();
  rpc.mockReset();
  Object.values(auth).forEach((fn) => fn.mockClear());
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useStore.setState(makeSeed());
  useAccount.setState({ phase: "signed-out", user: null, link: "unlinked", protection: "local-only", history: [], devices: [], message: "", error: "", conflictServerRevision: undefined, syncFailure: undefined, nextAttemptAt: undefined, snapshotBytes: undefined });
});

describe("account validation", () => {
  it("explains weak input before calling the service", async () => {
    expect(validateEmail("nope")).toMatch(/complete/);
    expect(validatePassword("short1")).toMatch(/at least 8/);
    expect(validatePassword("longpassword")).toMatch(/number/);
    expect(validatePassword("longpassword1")).toBeNull();
    expect(await useAccount.getState().signIn("not-an-email", "x")).toBe(false);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("account lifecycle", () => {
  it("signs in without uploading or replacing local work", async () => {
    const before = useStore.getState().courses.length;
    expect(await useAccount.getState().signIn("learner@example.com", "password123")).toBe(true);
    expect(useAccount.getState()).toMatchObject({ phase: "signed-in", link: "unlinked", protection: "local-only" });
    expect(useAccount.getState().user?.email).toBe("learner@example.com");
    expect(rpc).not.toHaveBeenCalled();
    expect(useStore.getState().courses.length).toBe(before);
    expect(localStorage.getItem("axom.sync.metadata.v1") ?? "").not.toContain("secret-access");
  });

  it("links a device against base 0 so existing account work surfaces as a conflict, then resolves by keeping this device", async () => {
    await useAccount.getState().signIn("learner@example.com", "password123");
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "push_workspace_revision") {
        return args.p_base_revision === 0
          ? { data: { status: "conflict", server_revision: 7, preserved_revision_id: "c1" }, error: null }
          : { data: { status: "accepted", revision: 8, revision_id: "r8", idempotent: false }, error: null };
      }
      return { data: null, error: null };
    });
    await useAccount.getState().linkThisDevice();
    expect(useAccount.getState()).toMatchObject({ link: "linked", protection: "conflict", conflictServerRevision: 7 });
    const firstPush = rpc.mock.calls.find(([name]) => name === "push_workspace_revision")!;
    expect(firstPush[1]).toMatchObject({ p_base_revision: 0, p_reason: "foundation" });

    await useAccount.getState().keepThisDevice();
    const pushes = rpc.mock.calls.filter(([name]) => name === "push_workspace_revision");
    expect(pushes.at(-1)![1]).toMatchObject({ p_base_revision: 7, p_reason: "manual" });
    expect(pushes.at(-1)![1].p_idempotency_key).not.toBe(firstPush[1].p_idempotency_key);
    expect(useAccount.getState()).toMatchObject({ protection: "protected", conflictServerRevision: undefined });
  });

  it("merges both versions on conflict: records combine, nothing is deleted, and the result becomes a new revision", async () => {
    const { toPortableState } = await import("../backup");
    await useAccount.getState().signIn("learner@example.com", "password123");
    const server = makeSeed();
    server.tasks = [...server.tasks, { id: "server-only-task", title: "From the laptop", done: false, created: "2026-09-20T10:00:00Z" }];
    tables.workspace_revisions = [{ id: "r7", revision: 7, schema_version: server.schemaVersion, content_hash: "a".repeat(64), snapshot_payload: toPortableState(server), reason: "automatic", created_at: "2026-09-25T10:00:00Z" }];
    useStore.setState({ tasks: [...useStore.getState().tasks, { id: "device-only-task", title: "From the phone", done: false, created: "2026-09-21T10:00:00Z" }] });
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "push_workspace_revision") {
        return args.p_base_revision === 0
          ? { data: { status: "conflict", server_revision: 7, preserved_revision_id: "c1" }, error: null }
          : { data: { status: "accepted", revision: 8, revision_id: "r8", idempotent: false }, error: null };
      }
      return { data: null, error: null };
    });
    await useAccount.getState().linkThisDevice();
    expect(useAccount.getState().protection).toBe("conflict");

    await useAccount.getState().mergeWithAccount();
    const ids = useStore.getState().tasks.map((task) => task.id);
    expect(ids).toEqual(expect.arrayContaining(["server-only-task", "device-only-task"]));
    const lastPush = rpc.mock.calls.filter(([name]) => name === "push_workspace_revision").at(-1)!;
    expect(lastPush[1]).toMatchObject({ p_base_revision: 7, p_reason: "manual" });
    expect(useAccount.getState()).toMatchObject({ protection: "protected", conflictServerRevision: undefined });
    tables.workspace_revisions = [];
  });

  it("sends and verifies a one-time code (works for the desktop app)", async () => {
    expect(await useAccount.getState().sendCode("learner@example.com")).toBe(true);
    expect(useAccount.getState().pendingCodeEmail).toBe("learner@example.com");
    expect(await useAccount.getState().verifyCode("learner@example.com", "12 34 56")).toBe(true);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "learner@example.com", token: "123456", type: "email" });
    expect(useAccount.getState().phase).toBe("signed-in");
  });

  it("confirms a new account with the emailed code instead of the link", async () => {
    expect(await useAccount.getState().signUp("learner@example.com", "password123", "Learner")).toBe(true);
    expect(useAccount.getState()).toMatchObject({ pendingCodeEmail: "learner@example.com", pendingCodeKind: "signup" });
    expect(await useAccount.getState().verifyCode("learner@example.com", "12345678")).toBe(true);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "learner@example.com", token: "12345678", type: "email" });
    expect(useAccount.getState()).toMatchObject({ phase: "signed-in", pendingCodeEmail: undefined, pendingCodeKind: undefined });
  });

  it("does not disclose existing-account status from signup errors", async () => {
    auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: { message: "User already registered" } } as never);

    expect(await useAccount.getState().signUp("learner@example.com", "password123", "Learner")).toBe(false);
    expect(useAccount.getState().error).not.toMatch(/already registered|already exists/i);
  });

  it("resets a password with the recovery code, then asks for the new password", async () => {
    expect(await useAccount.getState().requestPasswordReset("learner@example.com")).toBe(true);
    expect(useAccount.getState().pendingCodeKind).toBe("recovery");
    expect(await useAccount.getState().verifyCode("learner@example.com", "87654321")).toBe(true);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "learner@example.com", token: "87654321", type: "recovery" });
    expect(useAccount.getState().phase).toBe("recovering-password");
    expect(await useAccount.getState().updatePassword("newpassword9")).toBe(true);
    expect(useAccount.getState().phase).toBe("signed-in");
  });

  it("signs out and keeps the local workspace", async () => {
    await useAccount.getState().signIn("learner@example.com", "password123");
    const courses = useStore.getState().courses;
    await useAccount.getState().signOut();
    expect(useAccount.getState()).toMatchObject({ phase: "signed-out", user: null, link: "unlinked", protection: "local-only" });
    expect(useStore.getState().courses).toBe(courses);
  });

  it("keeps the signed-in state when the auth service rejects sign-out", async () => {
    await useAccount.getState().signIn("learner@example.com", "password123");
    auth.signOut.mockResolvedValueOnce({ error: { message: "Network unavailable" } } as never);

    await useAccount.getState().signOut();

    expect(useAccount.getState().phase).toBe("signed-in");
    expect(useAccount.getState().user?.id).toBe("user-1");
    expect(useAccount.getState().error).toBeTruthy();
  });

  it("does not report cloud deletion complete when the deletion RPC fails", async () => {
    await useAccount.getState().signIn("learner@example.com", "password123");
    useAccount.setState({ link: "linked", protection: "protected", history: [{ id: "r1" } as never] });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Deletion unavailable" } });

    await useAccount.getState().deleteCloudData();

    expect(useAccount.getState()).toMatchObject({ link: "linked", protection: "protected" });
    expect(useAccount.getState().history).toHaveLength(1);
    expect(useAccount.getState().message).not.toMatch(/Every server copy was deleted/);
    expect(useAccount.getState().error).toBeTruthy();
  });

  it("turns service errors into calm, specific guidance", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: { message: "Invalid login credentials" } } as never);
    expect(await useAccount.getState().signIn("learner@example.com", "wrongpass1")).toBe(false);
    expect(useAccount.getState().error).toMatch(/don’t match/);
  });
});

describe("account session consistency (Ideas 4: Profile and Account agree; sign-in shows fast)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("shows a saved session at once, before the account service loads", async () => {
    storedSession = { ...session, refresh_token: "refresh" };
    useAccount.setState({ phase: "loading", user: null });
    auth.onAuthStateChange.mockImplementationOnce((() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) as never);
    useAccount.getState().init();
    expect(useAccount.getState()).toMatchObject({ phase: "signed-in", user: { email: "learner@example.com" } });
  });

  it("takes the auth events as the only truth: a slow empty session read cannot sign you out", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } } as never);
    auth.onAuthStateChange.mockImplementationOnce(((callback: (event: string, value: unknown) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }) as never);
    useAccount.getState().init();
    await flush();
    await flush();
    expect(useAccount.getState().phase).toBe("signed-in");
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("follows a real sign-out event", async () => {
    let emit: (event: string, value: unknown) => void = () => undefined;
    auth.onAuthStateChange.mockImplementationOnce(((callback: (event: string, value: unknown) => void) => {
      emit = callback;
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }) as never);
    useAccount.getState().init();
    await flush();
    emit("SIGNED_OUT", null);
    expect(useAccount.getState()).toMatchObject({ phase: "signed-out", user: null });
  });

  it("keeps a signed-in user signed in when the account service fails to load", async () => {
    storedSession = { ...session, refresh_token: "refresh" };
    loadFails = true;
    useAccount.setState({ phase: "loading", user: null });
    useAccount.getState().init();
    await flush();
    await flush();
    expect(useAccount.getState()).toMatchObject({ phase: "signed-in", user: { id: "user-1" } });
    expect(useAccount.getState().error).toMatch(/Couldn’t reach the account service/);
  });

  it("without a saved session, a failed load reads as signed out with a calm note", async () => {
    loadFails = true;
    useAccount.setState({ phase: "loading", user: null });
    useAccount.getState().init();
    await flush();
    await flush();
    expect(useAccount.getState().phase).toBe("signed-out");
    expect(useAccount.getState().error).toMatch(/still saved on this device/);
  });
});

describe("a refused upload (the production failure of 2026-09-30)", () => {
  /** What an account before migration 20261001090000 answers once its history is full. */
  const historyFull = { data: null, error: { code: "54000", message: "workspace snapshot storage limit reached; reduce the snapshot size before syncing", details: null, hint: null }, status: 500 };
  const pushes = () => rpc.mock.calls.filter(([name]) => name === "push_workspace_revision");

  it("says what happened, stops repeating it, and recovers when the account accepts again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await useAccount.getState().signIn("learner@example.com", "password123");
    let answer: unknown = historyFull;
    rpc.mockImplementation(async (name: string) => (name === "push_workspace_revision" ? answer : { data: null, error: null }));

    await useAccount.getState().linkThisDevice();
    expect(useAccount.getState()).toMatchObject({ link: "linked", protection: "blocked", syncFailure: { kind: "rejected", rejection: "storage-limit", status: 500, code: "54000" } });
    expect(useAccount.getState().message).toMatch(/version history is full/);
    expect(useAccount.getState().message).toMatch(/saved on this device/);
    expect(pushes()).toHaveLength(1);
    // Bookkeeping never holds what the account wrote back.
    expect(localStorage.getItem("axom.sync.metadata.v1")).not.toMatch(/storage limit/);

    // "Try again" is the learner's call: one upload, and no stale "Protecting now…" notice.
    await useAccount.getState().syncNow();
    expect(pushes()).toHaveLength(2);
    expect(useAccount.getState()).toMatchObject({ protection: "blocked", message: "", busy: false });
    expect(Date.parse(useAccount.getState().nextAttemptAt!)).toBeGreaterThan(Date.now() + 59 * 60_000);

    answer = { data: { status: "accepted", revision: 72, revision_id: "r72", idempotent: false }, error: null, status: 200 };
    await useAccount.getState().syncNow();
    expect(useAccount.getState()).toMatchObject({ protection: "protected", message: "Protected just now.", syncFailure: undefined, nextAttemptAt: undefined });
    vi.restoreAllMocks();
  });

  it("explains each kind of trouble in plain words", () => {
    const at = "2026-10-01T10:00:00.000Z";
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    expect(protectionDetail({ protection: "protected" })).toBeNull();
    expect(protectionDetail({ protection: "saved-locally" })).toBeNull();
    expect(protectionDetail({ protection: "conflict" })).toBeNull();
    const tooLarge = protectionDetail({ protection: "blocked", syncFailure: { kind: "rejected", rejection: "too-large", status: 0, at } });
    expect(tooLarge).toMatch(/larger than an account copy can be \(15 MB\)/);
    expect(tooLarge).toMatch(/Emergency recovery/);
    expect(protectionDetail({ protection: "blocked", syncFailure: { kind: "rejected", rejection: "refused", status: 400, at }, nextAttemptAt: soon })).toMatch(/refused this upload.*tries again by itself around/);
    expect(protectionDetail({ protection: "paused", syncFailure: { kind: "server", status: 500, at }, nextAttemptAt: soon })).toMatch(/after several tries.*checks less often.*tries again by itself around/);
    expect(protectionDetail({ protection: "retrying", syncFailure: { kind: "network", status: 0, at } })).toMatch(/could not reach your account/);
    expect(protectionDetail({ protection: "retrying", syncFailure: { kind: "auth", status: 401, at } })).toMatch(/sign out and sign in again/);
    for (const status of ["retrying", "paused", "blocked"] as const) {
      const detail = protectionDetail({ protection: status, syncFailure: { kind: "server", status: 500, at } })!;
      expect(detail).toMatch(/saved on this device/);
      expect(detail).not.toMatch(/—/);
      expect(protectionLabel(status)).not.toMatch(/—/);
    }
    expect(failureSummary({ syncFailure: { kind: "rejected", rejection: "storage-limit", status: 500, code: "54000", at }, snapshotBytes: 9_628_115 }))
      .toMatch(/refused \(storage-limit\), HTTP 500, code 54000\. Snapshot size 9\.6 MB\./);
    expect(failureSummary({ syncFailure: { kind: "network", status: 0, at } })).toMatch(/network, no answer\./);
    expect(failureSummary({})).toBe("");
  });
});

describe("signing in brings your AXOM back (Priority 4), never over your own work", () => {
  async function serverVersion() {
    const { toPortableState } = await import("../backup");
    const server = makeSeed();
    server.tasks = [...server.tasks, { id: "laptop-task", title: "From the laptop", done: false, created: "2026-09-20T10:00:00Z" }];
    tables.workspace_revisions = [{ id: "r5", revision: 5, schema_version: server.schemaVersion, content_hash: "b".repeat(64), snapshot_payload: toPortableState(server), reason: "automatic", created_at: "2026-09-28T18:00:00Z" }];
  }
  const accepting = async (name: string) => (name === "push_workspace_revision"
    ? { data: { status: "accepted", revision: 6, revision_id: "r6", idempotent: false }, error: null }
    : { data: null, error: null });

  it("restores the account's latest version on a device with no work of its own", async () => {
    await serverVersion();
    rpc.mockImplementation(accepting as never);
    expect(await useAccount.getState().signIn("learner@example.com", "password123")).toBe(true);
    expect(useStore.getState().tasks.map((task) => task.id)).toContain("laptop-task");
    expect(useAccount.getState()).toMatchObject({ link: "linked", restoreOffer: undefined });
    expect(useAccount.getState().message).toMatch(/^Welcome back\. Your AXOM from/);
    tables.workspace_revisions = [];
  });

  it("offers the choice instead when this device has work, and changes nothing until chosen", async () => {
    await serverVersion();
    useStore.setState({ logs: [{ id: "phone-log", dayKey: "2026-09-29", ts: "2026-09-29T09:00:00Z", type: "Pomodoro", minutes: 25, cards: 0 }] as never });
    await useAccount.getState().signIn("learner@example.com", "password123");
    expect(useAccount.getState().restoreOffer).toMatchObject({ id: "r5", revision: 5 });
    expect(useStore.getState().tasks.map((task) => task.id)).not.toContain("laptop-task");
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockImplementation(accepting as never);
    await useAccount.getState().adoptAccountVersion();
    expect(useStore.getState().tasks.map((task) => task.id)).toContain("laptop-task");
    expect(useAccount.getState().restoreOffer).toBeUndefined();
    tables.workspace_revisions = [];
  });

  it("keeps this device's work as the version that continues when chosen", async () => {
    await serverVersion();
    useStore.setState({ tasks: [...useStore.getState().tasks, { id: "phone-task", title: "Call the lab", done: false, created: "2026-09-29T10:00:00Z" }] });
    await useAccount.getState().signIn("learner@example.com", "password123");
    expect(useAccount.getState().restoreOffer).toBeDefined();
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "push_workspace_revision") {
        return args.p_base_revision === 0
          ? { data: { status: "conflict", server_revision: 5, preserved_revision_id: "c2" }, error: null }
          : { data: { status: "accepted", revision: 6, revision_id: "r6", idempotent: false }, error: null };
      }
      return { data: null, error: null };
    });
    await useAccount.getState().keepDeviceWork();
    expect(useStore.getState().tasks.map((task) => task.id)).toContain("phone-task");
    expect(useStore.getState().tasks.map((task) => task.id)).not.toContain("laptop-task");
    expect(useAccount.getState()).toMatchObject({ link: "linked", protection: "protected", restoreOffer: undefined });
    tables.workspace_revisions = [];
  });
});
