// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Independent R48 integration contract. Real Zustand accountStore, mocked only
// external Supabase calls. No credentials, production DB, or learner records.
type ProfileResult = { data: { display_name: string } | null; error: { message: string } | null };
let emitAuth: ((event: string, session: Session | null) => void) | undefined;
const onAuthStateChange = vi.fn((handler: (event: string, session: Session | null) => void) => {
  emitAuth = handler;
  return { data: { subscription: { unsubscribe: vi.fn() } } };
});
const readQueue: Array<() => Promise<ProfileResult>> = [];
const maybeSingle = vi.fn((): Promise<ProfileResult> =>
  (readQueue.shift() ?? (() => Promise.resolve({ data: null, error: null })))());
const supabase = {
  auth: { onAuthStateChange },
  from: (table: string) => {
    if (table !== "account_profiles") throw new Error("Unexpected synthetic table");
    return { select: () => ({ eq: () => ({ maybeSingle }) }) };
  },
};
vi.mock("./supabase", () => ({
  authRedirectUrl: () => "http://localhost/",
  cloudConfigured: () => true,
  getSupabase: () => supabase,
  loadSupabase: async () => supabase,
  readStoredSession: () => null,
}));

const { useAccount, resetAccountInitForTests } = await import("./accountStore");

function sessionForA(): Session {
  return {
    user: {
      id: "synthetic-a", email: "synthetic-a@example.test",
      user_metadata: { display_name: "Stale SDK" },
      email_confirmed_at: "2026-11-01T12:00:00Z",
    },
  } as unknown as Session;
}

function deferredRead() {
  let resolve!: (response: ProfileResult) => void;
  let reject!: (cause: Error) => void;
  const pending = new Promise<ProfileResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  readQueue.push(() => pending);
  return {
    succeed: (name: string) => resolve({ data: { display_name: name }, error: null }),
    failResponse: () => resolve({ data: null, error: { message: "Synthetic Supabase SELECT error" } }),
    fail: () => reject(new Error("Synthetic profile SELECT failure")),
  };
}

async function subscribe() {
  useAccount.getState().init();
  await vi.waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1));
}

async function startTwoReads() {
  await subscribe();
  const earlier = deferredRead();
  emitAuth!("INITIAL_SESSION", sessionForA());
  await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(1));

  const later = deferredRead();
  emitAuth!("TOKEN_REFRESHED", sessionForA());
  await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledTimes(2));
  expect(useAccount.getState().user?.displayName).toBe("Stale SDK");
  return { earlier, later };
}

beforeEach(() => {
  resetAccountInitForTests();
  localStorage.clear();
  readQueue.length = 0;
  emitAuth = undefined;
  onAuthStateChange.mockClear();
  maybeSingle.mockClear();
  // Begin each test outside account A. The real auth transition then clears
  // closure-scoped confirmed profile names and establishes a fresh identity epoch.
  // resetAccountInitForTests() resets only the subscription, not these values.
  useAccount.setState({
    phase: "signed-out", user: null,
    link: "unlinked", protection: "local-only", busy: false, error: "", message: "",
  });
});

describe("same-owner profile read fallback when a newer SELECT is unsuccessful", () => {
  it("uses the earlier valid server response if the later SELECT throws", async () => {
    const { earlier, later } = await startTwoReads();
    later.fail();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    earlier.succeed("Server-authoritative A");
    await vi.waitFor(() =>
      expect(useAccount.getState().user?.displayName).toBe("Server-authoritative A"));
  });

  it("uses an earlier valid server response if the later SELECT returns an explicit error", async () => {
    const { earlier, later } = await startTwoReads();
    later.failResponse();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    earlier.succeed("Existing server profile");
    await vi.waitFor(() =>
      expect(useAccount.getState().user?.displayName).toBe("Existing server profile"));
  });

  it("still prefers the later successful response to an earlier successful response", async () => {
    const { earlier, later } = await startTwoReads();
    later.succeed("Latest server profile");
    await vi.waitFor(() =>
      expect(useAccount.getState().user?.displayName).toBe("Latest server profile"));
    earlier.succeed("Superseded earlier value");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(useAccount.getState().user?.displayName).toBe("Latest server profile");
  });
});
