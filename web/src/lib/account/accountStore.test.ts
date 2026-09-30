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

vi.mock("./supabase", () => ({
  cloudConfigured: () => true,
  getSupabase: () => ({ auth, rpc, from: (table: string) => chain(table) }),
  loadSupabase: async () => ({ auth, rpc, from: (table: string) => chain(table) }),
  authRedirectUrl: () => "http://localhost/",
}));

const { useAccount, validateEmail, validatePassword } = await import("./accountStore");
const { useStore } = await import("../store");
const { makeSeed } = await import("../seed");

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  Object.values(auth).forEach((fn) => fn.mockClear());
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useStore.setState(makeSeed());
  useAccount.setState({ phase: "signed-out", user: null, link: "unlinked", protection: "local-only", history: [], devices: [], message: "", error: "", conflictServerRevision: undefined });
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
