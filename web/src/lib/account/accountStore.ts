import { create } from "zustand";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { authRedirectUrl, cloudConfigured, loadSupabase, readStoredSession } from "./supabase";
import { SyncCoordinator } from "../sync/syncCoordinator";
import { SupabaseSyncTransport } from "../sync/supabaseTransport";
import { clearAccountSync, deviceId, read, write } from "../sync/syncMetadata";
import type { AccountDevice, ProtectionStatus, RevisionSummary } from "../sync/syncTypes";
import { useStore } from "../store";
import { createLocalBackup } from "../localBackup";
import { mergeStates, parseImport } from "../backup";
import { recordRestoreEvent } from "../restoreHistory";

/**
 * App-wide account state. The Settings panel, the sidebar status badge, and
 * the background sync watcher all read this one store, so protection keeps
 * running after Settings closes and every surface agrees on the status.
 *
 * Invariants (unchanged from the account foundation):
 * - An account is optional; local work is always legitimate and immediate.
 * - Signing in never uploads or replaces anything until the learner chooses.
 * - Restores snapshot the device first and are recorded as new revisions.
 */
export type AccountPhase = "unconfigured" | "loading" | "signed-out" | "signed-in" | "recovering-password";

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  createdAt?: string;
  emailConfirmed: boolean;
}

export type LinkState = "linked" | "unlinked" | "linked-elsewhere";

/** Every AXOM auth email carries a code, so desktop users never need the link. */
export type CodeKind = "sign-in" | "signup" | "recovery";

interface AccountState {
  phase: AccountPhase;
  user: AccountUser | null;
  link: LinkState;
  protection: ProtectionStatus;
  lastProtectedAt?: string;
  conflictServerRevision?: number;
  history: RevisionSummary[];
  devices: AccountDevice[];
  busy: boolean;
  message: string;
  error: string;
  /** An email address awaiting a one-time code. */
  pendingCodeEmail?: string;
  /** Which email the code came from; recovery codes open the new-password step. */
  pendingCodeKind?: CodeKind;

  init(): void;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(email: string, password: string, displayName: string): Promise<boolean>;
  sendCode(email: string): Promise<boolean>;
  verifyCode(email: string, code: string): Promise<boolean>;
  requestPasswordReset(email: string): Promise<boolean>;
  updatePassword(password: string): Promise<boolean>;
  updateDisplayName(name: string): Promise<boolean>;
  signOut(): Promise<void>;
  linkThisDevice(): Promise<void>;
  syncNow(): Promise<void>;
  refresh(): Promise<void>;
  restoreRevision(summary: RevisionSummary): Promise<void>;
  keepThisDevice(): Promise<void>;
  adoptAccountVersion(): Promise<void>;
  /** Resolve a conflict by combining both versions record-by-record. */
  mergeWithAccount(): Promise<void>;
  forgetDevice(id: string): Promise<void>;
  deleteCloudData(): Promise<void>;
  clearNotice(): void;
  /** Internal: the running coordinator (watcher-owned). */
  attachCoordinator(coordinator: SyncCoordinator | null): void;
}

let authSubscription: { unsubscribe(): void } | null = null;
let initializing = false;

/** Test hook: forget the auth subscription so init() can run again. */
export function resetAccountInitForTests(): void {
  authSubscription?.unsubscribe();
  authSubscription = null;
  initializing = false;
}
let coordinator: SyncCoordinator | null = null;
const transport = new SupabaseSyncTransport();

export const PASSWORD_MIN_LENGTH = 8;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That email address doesn’t look complete.";
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return "Mix letters and at least one number.";
  return null;
}

export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "This device";
  const ua = navigator.userAgent;
  const os = /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
      : /iPhone|iPad/.test(ua) ? "iOS"
        : /Android/.test(ua) ? "Android"
          : /Linux/.test(ua) ? "Linux" : "Device";
  const app = "__TAURI_INTERNALS__" in globalThis ? "AXOM desktop" : /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${app} on ${os}`;
}

function friendlyError(error: unknown): string {
  const raw = typeof error === "string"
    ? error
    : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  if (/invalid login credentials/i.test(raw)) return "That email and password don’t match an account.";
  if (/email not confirmed/i.test(raw)) return "Confirm your email first — check your inbox for the AXOM message.";
  if (/user already registered/i.test(raw)) return "If that address can be used, AXOM will send the next step. Try signing in or request a code.";
  if (/rate limit|too many/i.test(raw)) return "Too many attempts. Wait a minute and try again.";
  if (/token has expired|otp.*expired|invalid.*otp/i.test(raw)) return "That code is invalid or expired. Request a new one.";
  if (/failed to fetch|network/i.test(raw)) return "AXOM couldn’t reach the account service. Your work is still saved on this device.";
  return raw || "The account service didn’t respond. Your work is still saved on this device.";
}

function toUser(session: Session | null, profileName?: string): AccountUser | null {
  if (!session?.user) return null;
  const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const email = session.user.email ?? "";
  return {
    id: session.user.id,
    email,
    displayName: profileName ?? (typeof meta.display_name === "string" && meta.display_name.trim() ? meta.display_name : email.split("@")[0] || "Learner"),
    createdAt: session.user.created_at,
    emailConfirmed: Boolean(session.user.email_confirmed_at ?? session.user.confirmed_at),
  };
}

/** Everything the account UI shows for a session, derived in one place. */
function sessionState(session: Session | null): Pick<AccountState, "phase" | "user" | "link" | "lastProtectedAt" | "conflictServerRevision" | "protection"> {
  const user = toUser(session);
  const meta = read();
  const link = linkStateFor(user?.id);
  return {
    phase: user ? "signed-in" : "signed-out",
    user,
    link,
    lastProtectedAt: meta.lastProtectedAt,
    conflictServerRevision: meta.conflictServerRevision,
    protection: user && link === "linked"
      ? (meta.conflictServerRevision !== undefined ? "conflict" : meta.pending ? "saved-locally" : meta.lastProtectedAt ? "protected" : "saved-locally")
      : "local-only",
  };
}

function linkStateFor(userId: string | undefined): LinkState {
  const linkedTo = read().accountUserId;
  if (!userId || !linkedTo) return "unlinked";
  return linkedTo === userId ? "linked" : "linked-elsewhere";
}

async function client(): Promise<SupabaseClient> {
  const value = await loadSupabase();
  if (!value) throw new Error("Accounts aren’t configured in this build. AXOM remains fully local.");
  return value;
}

export const useAccount = create<AccountState>((set, get) => {
  async function guarded<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
    set({ busy: true, error: "", message: label });
    try {
      return await run();
    } catch (error) {
      set({ error: friendlyError(error), message: "" });
      return undefined;
    } finally {
      set({ busy: false });
    }
  }

  function applySession(session: Session | null) {
    const next = sessionState(session);
    // Keep a display name the profile table already supplied for this user.
    const current = get().user;
    if (next.user && current?.id === next.user.id && current.displayName && !session?.user?.user_metadata?.display_name) {
      next.user = { ...next.user, displayName: current.displayName };
    }
    set(next);
    if (next.user) void loadProfileName(next.user.id);
  }

  async function loadProfileName(userId: string) {
    try {
      const { data } = await (await client()).from("account_profiles").select("display_name").eq("user_id", userId).maybeSingle();
      const name = (data as { display_name?: string } | null)?.display_name;
      const user = get().user;
      if (name && user && user.id === userId) set({ user: { ...user, displayName: name } });
    } catch {
      // Profile names are cosmetic; the account still works.
    }
  }

  // A saved, refreshable session is shown immediately (no wait for the SDK
  // download or the network); the SDK's first auth event confirms or clears it.
  const stored = cloudConfigured() ? readStoredSession() : null;
  return {
    ...(stored ? sessionState(stored) : { phase: cloudConfigured() ? "loading" as const : "unconfigured" as const, user: null, link: "unlinked" as const, protection: "local-only" as const }),
    history: [],
    devices: [],
    busy: false,
    message: "",
    error: "",

    init() {
      if (authSubscription || initializing || !cloudConfigured()) return;
      initializing = true;
      if (get().phase === "loading") {
        const stored = readStoredSession();
        if (stored) applySession(stored);
      }
      void loadSupabase().then((supabase) => {
        if (!supabase || authSubscription) return;
        // One source of truth: the SDK emits INITIAL_SESSION on subscribe and
        // every later change. (A separate getSession() used to race it, and a
        // refresh that failed on a flaky network read as "signed out" while
        // the SDK still held the session: Profile and Account then disagreed.)
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === "PASSWORD_RECOVERY") {
            set({ phase: "recovering-password", user: toUser(session), message: "Choose a new password to finish recovery." });
            return;
          }
          applySession(session);
        });
        authSubscription = data.subscription;
      }).catch(() => {
        // The account service did not load (offline, blocked). A signed-in user
        // stays signed in; the next launch or reconnect confirms the session.
        set(get().user
          ? { error: "Couldn’t reach the account service just now. Your work is saved on this device." }
          : { phase: "signed-out", error: "The account service couldn’t load. Your work is still saved on this device." });
      }).finally(() => { initializing = false; });
    },

    async signIn(email, password) {
      const emailError = validateEmail(email);
      if (emailError) { set({ error: emailError }); return false; }
      const result = await guarded("Signing in…", async () => {
        const { data, error } = await (await client()).auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        applySession(data.session);
        return true;
      });
      if (result) set({ message: "Signed in. Nothing on this device has changed." });
      return Boolean(result);
    },

    async signUp(email, password, displayName) {
      const emailError = validateEmail(email) ?? validatePassword(password);
      if (emailError) { set({ error: emailError }); return false; }
      const result = await guarded("Creating your account…", async () => {
        const { data, error } = await (await client()).auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim().slice(0, 80) || useStore.getState().profile.name || "Learner" },
            emailRedirectTo: authRedirectUrl(),
          },
        });
        if (error) throw error;
        if (data.session) applySession(data.session);
        return data.session ? "signed-in" : "confirm";
      });
      if (result === "confirm") set({ pendingCodeEmail: email.trim(), pendingCodeKind: "signup", message: `We emailed a confirmation code to ${email.trim()}. Enter it below, or use the link in the email. Local work is unchanged.` });
      if (result === "signed-in") set({ message: "Account created. Choose whether to protect this device’s workspace." });
      return Boolean(result);
    },

    async sendCode(email) {
      const emailError = validateEmail(email);
      if (emailError) { set({ error: emailError }); return false; }
      const result = await guarded("Sending a sign-in code…", async () => {
        const { error } = await (await client()).auth.signInWithOtp({
          email: email.trim(),
          options: { shouldCreateUser: true, emailRedirectTo: authRedirectUrl() },
        });
        if (error) throw error;
        return true;
      });
      if (result) set({ pendingCodeEmail: email.trim(), pendingCodeKind: "sign-in", message: `We sent a code to ${email.trim()}. Enter it below — it works in the desktop app too.` });
      return Boolean(result);
    },

    async verifyCode(email, code) {
      const token = code.replace(/\s+/g, "");
      if (!/^\d{6,10}$/.test(token)) { set({ error: "Enter the numeric code from the email." }); return false; }
      const recovery = get().pendingCodeKind === "recovery";
      const result = await guarded("Checking your code…", async () => {
        // "email" verifies both sign-in and sign-up confirmation codes.
        const { data, error } = await (await client()).auth.verifyOtp({ email: email.trim(), token, type: recovery ? "recovery" : "email" });
        if (error) throw error;
        applySession(data.session);
        return true;
      });
      if (result && recovery) set({ pendingCodeEmail: undefined, pendingCodeKind: undefined, phase: "recovering-password", message: "Code accepted. Choose a new password to finish." });
      else if (result) set({ pendingCodeEmail: undefined, pendingCodeKind: undefined, message: "Signed in. Nothing on this device has changed." });
      return Boolean(result);
    },

    async requestPasswordReset(email) {
      const emailError = validateEmail(email);
      if (emailError) { set({ error: emailError }); return false; }
      const result = await guarded("Sending a reset link…", async () => {
        const { error } = await (await client()).auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirectUrl() });
        if (error) throw error;
        return true;
      });
      if (result) set({ pendingCodeEmail: email.trim(), pendingCodeKind: "recovery", message: "If that email has an account, a reset code and link are on their way. Enter the code below." });
      return Boolean(result);
    },

    async updatePassword(password) {
      const passwordError = validatePassword(password);
      if (passwordError) { set({ error: passwordError }); return false; }
      const result = await guarded("Saving your new password…", async () => {
        const { data, error } = await (await client()).auth.updateUser({ password });
        if (error) throw error;
        set({ phase: data.user ? "signed-in" : get().phase });
        return true;
      });
      if (result) set({ message: "Password updated." });
      return Boolean(result);
    },

    async updateDisplayName(name) {
      const displayName = name.trim().slice(0, 80);
      const user = get().user;
      if (!user || !displayName) return false;
      const result = await guarded("Saving your name…", async () => {
        const { error } = await (await client()).from("account_profiles").upsert({ user_id: user.id, display_name: displayName, updated_at: new Date().toISOString() });
        if (error) throw error;
        await (await client()).auth.updateUser({ data: { display_name: displayName } });
        set({ user: { ...user, displayName } });
        return true;
      });
      if (result) set({ message: "Account name updated." });
      return Boolean(result);
    },

    async signOut() {
      const signedOut = await guarded("Signing out…", async () => {
        const supabase = await loadSupabase();
        if (!supabase && cloudConfigured()) throw new Error("The account service couldn’t load. Try again before signing out.");
        if (supabase) {
          const { error } = await supabase.auth.signOut();
          if (error) throw error;
        }
        coordinator?.dispose();
        return true;
      });
      if (!signedOut) return;
      clearAccountSync();
      set({
        phase: cloudConfigured() ? "signed-out" : "unconfigured",
        user: null,
        link: "unlinked",
        protection: "local-only",
        history: [],
        devices: [],
        conflictServerRevision: undefined,
        message: "Signed out. This device’s workspace is still here.",
      });
    },

    async linkThisDevice() {
      const user = get().user;
      if (!user) return;
      await guarded("Protecting this device’s workspace…", async () => {
        const meta = read();
        // A newly linked device uploads against base 0. If the account already
        // holds work from another device, the server keeps BOTH and reports a
        // conflict for the learner to resolve — never a silent overwrite.
        write({ ...meta, accountUserId: user.id, baseRevision: meta.accountUserId === user.id ? meta.baseRevision : 0 });
        const linkCoordinator = coordinator ?? new SyncCoordinator(transport, () => useStore.getState(), 0);
        linkCoordinator.queue();
        await linkCoordinator.flush("foundation");
        const status = linkCoordinator.currentStatus();
        set({ link: "linked", protection: status, lastProtectedAt: read().lastProtectedAt, conflictServerRevision: read().conflictServerRevision });
        await transport.touchDevice({ deviceId: deviceId(), label: deviceLabel(), platform: platformName(), revision: read().baseRevision }).catch(() => undefined);
        set({
          message: status === "conflict"
            ? "Your account already has work from another device. Both versions are kept — choose which one continues."
            : status === "retrying"
              ? "AXOM couldn’t reach the account yet. Your work is saved here and will upload automatically."
              : "This workspace is protected. Changes now back up in the background.",
        });
      });
      await get().refresh();
    },

    async syncNow() {
      if (get().link !== "linked") return;
      await guarded("Protecting now…", async () => {
        const active = coordinator ?? new SyncCoordinator(transport, () => useStore.getState(), 0);
        active.queue();
        await active.flush("manual");
        set({ protection: active.currentStatus(), lastProtectedAt: read().lastProtectedAt, conflictServerRevision: read().conflictServerRevision });
      });
      set({ message: get().protection === "protected" ? "Protected just now." : get().message });
      void get().refresh();
    },

    async refresh() {
      if (!get().user) return;
      try {
        const [history, devices] = await Promise.all([
          transport.summaries(30),
          transport.devices(deviceId()).catch(() => [] as AccountDevice[]),
        ]);
        set({ history, devices });
      } catch (error) {
        set({ error: friendlyError(error) });
      }
    },

    async restoreRevision(summary) {
      const user = get().user;
      if (!user) return;
      await guarded("Restoring the protected version…", async () => {
        const revision = await transport.revision(summary.id);
        const next = parseImport(JSON.stringify(revision.payload));
        await createLocalBackup(useStore.getState().schemaVersion);
        useStore.getState().replaceAll(next);
        recordRestoreEvent({ kind: "account-restore", detail: `Protected version #${summary.revision} from ${new Date(summary.createdAt).toLocaleString()}` });
        const latest = await transport.latestRevision().catch(() => summary.revision);
        write({ ...read(), accountUserId: user.id, baseRevision: latest, conflictServerRevision: undefined, pending: true, pendingIdempotencyKey: crypto.randomUUID() });
        const active = coordinator ?? new SyncCoordinator(transport, () => useStore.getState(), 0);
        await active.flush("restore");
        set({
          link: "linked",
          protection: active.currentStatus(),
          conflictServerRevision: read().conflictServerRevision,
          lastProtectedAt: read().lastProtectedAt,
          message: "Restored. A safety snapshot of the previous device state was saved first, and the restore is recorded as a new version.",
        });
      });
      void get().refresh();
    },

    async keepThisDevice() {
      const server = get().conflictServerRevision ?? read().conflictServerRevision;
      if (server === undefined) return;
      await guarded("Keeping this device’s version…", async () => {
        const active = coordinator ?? new SyncCoordinator(transport, () => useStore.getState(), 0);
        await active.keepThisDevice(server);
        set({ protection: active.currentStatus(), conflictServerRevision: read().conflictServerRevision, lastProtectedAt: read().lastProtectedAt });
      });
      set({ message: "This device’s version now continues. The other version stays in history." });
      void get().refresh();
    },

    async mergeWithAccount() {
      const user = get().user;
      if (!user) return;
      await guarded("Merging this device with your account…", async () => {
        const [latest] = await transport.summaries(1);
        if (!latest) throw new Error("No account version is available to merge with yet.");
        const revision = await transport.revision(latest.id);
        const server = parseImport(JSON.stringify(revision.payload));
        await createLocalBackup(useStore.getState().schemaVersion);
        // Records combine by id; the newer copy of any record wins and nothing
        // is deleted — the same guarantees as merging a portable backup.
        const merged = mergeStates(useStore.getState(), server);
        useStore.getState().replaceAll(merged);
        recordRestoreEvent({ kind: "account-merge", detail: `Merged with protected version #${latest.revision}` });
        write({ ...read(), accountUserId: user.id, baseRevision: latest.revision, conflictServerRevision: undefined, pending: true, pendingIdempotencyKey: crypto.randomUUID() });
        const active = coordinator ?? new SyncCoordinator(transport, () => useStore.getState(), 0);
        await active.flush("manual");
        set({
          link: "linked",
          protection: active.currentStatus(),
          conflictServerRevision: read().conflictServerRevision,
          lastProtectedAt: read().lastProtectedAt,
          message: "Merged. Both devices’ records are combined (newer copies win, nothing deleted) and saved as a new version. A safety snapshot was taken first.",
        });
      });
      void get().refresh();
    },

    async adoptAccountVersion() {
      const history = get().history.length ? get().history : await transport.summaries(1).catch(() => []);
      const latest = history[0];
      if (!latest) { set({ error: "No account version is available yet." }); return; }
      await get().restoreRevision(latest);
    },

    async forgetDevice(id) {
      await guarded("Removing device…", async () => { await transport.forgetDevice(id); });
      void get().refresh();
    },

    async deleteCloudData() {
      const deleted = await guarded("Deleting cloud copies…", async () => {
        await transport.deleteCloudData();
        coordinator?.dispose();
        clearAccountSync();
        return true;
      });
      if (!deleted) return;
      set({ link: "unlinked", protection: "local-only", history: [], devices: [], conflictServerRevision: undefined, message: "Every server copy was deleted. This device’s workspace is untouched." });
    },

    clearNotice() {
      set({ message: "", error: "" });
    },

    attachCoordinator(next) {
      coordinator = next;
    },
  };
});

export function platformName(): string {
  if (typeof navigator === "undefined") return "unknown";
  return "__TAURI_INTERNALS__" in globalThis ? "desktop" : "web";
}

export function protectionLabel(status: ProtectionStatus): string {
  return {
    "local-only": "Local only",
    "saved-locally": "Saved locally",
    syncing: "Syncing",
    protected: "Protected",
    offline: "Offline — saved locally",
    retrying: "Retrying",
    conflict: "Action needed",
  }[status];
}
