import { retainDownloadedContent } from "../sync/contentDownloads";
import { snapshotWorkspace } from "../sync/workspaceSnapshot";
import { assertVaultWritesSince, getVaultWriteCheckpoint, flushLocalVaultWrites } from "../localVault";
import { create } from "zustand";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { authRedirectUrl, cloudConfigured, loadSupabase, readStoredSession } from "./supabase";
import { SyncCoordinator } from "../sync/syncCoordinator";
import { SupabaseSyncTransport } from "../sync/supabaseTransport";
import { clearAccountSync, deviceId, read, write } from "../sync/syncMetadata";
import { clearCloudContentCache } from "../sync/cloudContent";
import { clearCloudMediaUploadCache, workspaceMedia } from "../sync/cloudMedia";
import { adoptDeviceQuestionAttachments } from "../questionAttachments";
import { adoptDeviceSourceOriginals } from "../decode/sources";
import { contentMetadata } from "../sync/deferredContent";
import { getQuestionAttachmentScope, initializeQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, setQuestionAttachmentAccount } from "../questionAttachmentScope";
import { recordWorkspaceHydration } from "../workspaceHydrationReceipt";
import { storeHydration } from "../storeHydration";
import { clearCloudOriginalUploadCache } from "../sync/cloudOriginals";
import { restingStatus } from "../sync/syncPolicy";
import type { AccountDevice, ProtectionStatus, RevisionSummary, SyncFailure } from "../sync/syncTypes";
import { useStore } from "../store";
import { createLocalBackup } from "../localBackup";
import { mergeStates, parseImport } from "../backup";
import { recordRestoreEvent } from "../restoreHistory";
import { deviceHasOwnWork } from "../saveProgress";
import type { ShareMode } from "../community/progressBoard";

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

/** These choices seed a new account only. Existing accounts keep their saved consent. */
export interface CommunitySignupPreferences {
  discoverable: boolean;
  shareMode: ShareMode;
}

function signupCommunityPreferences(preferences?: CommunitySignupPreferences): CommunitySignupPreferences {
  return {
    discoverable: preferences?.discoverable === true,
    shareMode: preferences?.shareMode === "friends" || preferences?.shareMode === "community" ? preferences.shareMode : "off",
  };
}

interface AccountState {
  phase: AccountPhase;
  user: AccountUser | null;
  link: LinkState;
  protection: ProtectionStatus;
  lastProtectedAt?: string;
  conflictServerRevision?: number;
  /** The last failed upload, until one succeeds, and when AXOM tries next by itself. */
  syncFailure?: SyncFailure;
  nextAttemptAt?: string;
  /** Size of the last snapshot built on this device. */
  snapshotBytes?: number;
  history: RevisionSummary[];
  devices: AccountDevice[];
  busy: boolean;
  applyingRemote?: boolean;
  message: string;
  error: string;
  /** An email address awaiting a one-time code. */
  pendingCodeEmail?: string;
  /** Which email the code came from; recovery codes open the new-password step. */
  pendingCodeKind?: CodeKind;
  /** After signing in on a device with its own work: the account's latest version, waiting for the student's choice. */
  restoreOffer?: RevisionSummary;

  init(): void;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(email: string, password: string, displayName: string, communityPreferences?: CommunitySignupPreferences): Promise<boolean>;
  sendCode(email: string, communityPreferences?: CommunitySignupPreferences): Promise<boolean>;
  verifyCode(email: string, code: string): Promise<boolean>;
  requestPasswordReset(email: string): Promise<boolean>;
  updatePassword(password: string): Promise<boolean>;
  updateDisplayName(name: string): Promise<boolean>;
  signOut(): Promise<void>;
  linkThisDevice(): Promise<void>;
  syncNow(): Promise<void>;
  refresh(): Promise<void>;
  pullLatest(): Promise<void>;
  restoreRevision(summary: RevisionSummary): Promise<void>;
  keepThisDevice(): Promise<void>;
  adoptAccountVersion(): Promise<void>;
  /** From the welcome-back choice: keep this device's work as the version that continues. */
  keepDeviceWork(): Promise<void>;
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
const bootLinkedAccountId = read().accountUserId;
let bootInitialSessionScope: ReturnType<typeof getQuestionAttachmentScope> | undefined;

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

type ProtectionView = Pick<AccountState, "protection" | "lastProtectedAt" | "conflictServerRevision" | "syncFailure" | "nextAttemptAt" | "snapshotBytes">;

/** What the account UI shows about protection: a status plus the stored times and the last failure. */
export function protectionView(status: ProtectionStatus): ProtectionView {
  // An unlinked or signed-out viewer must not inherit the previous linked
  // account's cloud receipt or failure details. Keep durable sync metadata
  // untouched so its original owner can recover it after signing back in.
  if (status === "local-only") {
    return {
      protection: "local-only",
      lastProtectedAt: undefined,
      conflictServerRevision: undefined,
      syncFailure: undefined,
      nextAttemptAt: undefined,
      snapshotBytes: undefined,
    };
  }
  const meta = read();
  return {
    protection: status,
    lastProtectedAt: meta.lastProtectedAt,
    conflictServerRevision: meta.conflictServerRevision,
    syncFailure: meta.lastError,
    nextAttemptAt: meta.nextAttemptAt,
    snapshotBytes: meta.lastPayloadBytes,
  };
}

/** Everything the account UI shows for a session, derived in one place. */
function sessionState(session: Session | null): Pick<AccountState, "phase" | "user" | "link"> & ProtectionView {
  const user = toUser(session);
  const link = linkStateFor(user?.id);
  return {
    phase: user ? "signed-in" : "signed-out",
    user,
    link,
    ...protectionView(user && link === "linked" ? restingStatus(read()) : "local-only"),
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
  // Identity generations also distinguish A → B → A, where checking only the
  // final account ID would admit stale asynchronous responses from the first A.
  let accountIdentityEpoch = 0;
  // A profile SELECT may finish after a successful local rename. Among
  // overlapping SELECTs, only successful authoritative reads supersede older
  // results: a failed later request must not suppress a valid earlier one.
  let profileReadOrder = 0;
  let profileAppliedReadOrder = 0;
  let profileWriteOrder = 0;
  // Serialize profile/auth receipts only within the same owner, not across
  // different accounts in a shared store. A stuck A upload must not stall B.
  // Keep an earlier A turn pending across A -> B -> A: same-owner writes may
  // otherwise race with an already-issued A request at the server.
  const profileRenameQueues = new Map<string, Promise<void>>();
  let confirmedProfileName: { userId: string; epoch: number; name: string } | undefined;
  // Keep the SDK-derived fallback separate from an authoritative profile name.
  // A successful no-row read must not retain a removed profile's cached name.
  let latestAuthFallback: { userId: string; epoch: number; name: string } | undefined;
  function clearAccountUploadCaches() {
    clearCloudContentCache();
    clearCloudMediaUploadCache();
    clearCloudOriginalUploadCache();
  }

  async function guarded<T>(
    label: string,
    run: () => Promise<T>,
    isCurrent: () => boolean = () => true,
  ): Promise<T | undefined> {
    set({ busy: true, error: "", message: label });
    try {
      return await run();
    } catch (error) {
      // A completed request must never overwrite the next account's notices.
      if (isCurrent()) set({ error: friendlyError(error), message: "" });
      return undefined;
    } finally {
      if (isCurrent()) set({ busy: false });
    }
  }

  function applySession(session: Session | null) {
    const next = sessionState(session);
    // Keep a display name the profile table already supplied for this user.
    const current = get().user;
    const ownerChanged = current?.id !== next.user?.id;
    if (ownerChanged || !next.user) {
      accountIdentityEpoch += 1;
      confirmedProfileName = undefined;
      latestAuthFallback = undefined;
      clearAccountUploadCaches();
    }
    // Capture the current session's metadata BEFORE applying a cached name.
    // Later reads can safely return to this fallback when the row is absent.
    if (next.user) latestAuthFallback = {
      userId: next.user.id, epoch: accountIdentityEpoch, name: next.user.displayName,
    };
    const confirmedName = confirmedProfileName;
    if (next.user && !ownerChanged && current?.displayName) {
      // An SDK refresh may carry stale auth metadata after the profile table
      // acknowledged a newer name. A fresh profile SELECT can still replace it.
      const name = confirmedName?.epoch === accountIdentityEpoch && confirmedName.userId === next.user.id
        ? confirmedName.name
        : !session?.user?.user_metadata?.display_name ? current.displayName : undefined;
      if (name) next.user = { ...next.user, displayName: name };
    }
    // Zustand's set() is shallow: omitting these fields retains A's private
    // history/devices/restore candidate under B, even with no network.
    set(ownerChanged || !next.user
      ? { ...next, history: [], devices: [], restoreOffer: undefined,
        busy: false, applyingRemote: false, message: "", error: "",
        // A code's destination is private account-entry state. Clear it on
        // genuine identity transitions, not redundant signed-out SDK events.
        ...(ownerChanged ? { pendingCodeEmail: undefined, pendingCodeKind: undefined } : {}) }
      : next);
    if (next.user) void loadProfileName(next.user.id);
  }

  /** The watcher's coordinator when one is running; otherwise a short-lived one. */
  async function withCoordinator<T>(run: (active: SyncCoordinator) => Promise<T>): Promise<T> {
    if (coordinator) return run(coordinator);
    const temporary = new SyncCoordinator(transport, () => useStore.getState(), 0);
    try {
      return await run(temporary);
    } finally {
      temporary.dispose();
    }
  }

  async function loadProfileName(userId: string) {
    const epoch = accountIdentityEpoch;
    const readOrder = ++profileReadOrder;
    const writeOrder = profileWriteOrder;
    try {
      const { data, error } = await (await client()).from("account_profiles").select("display_name").eq("user_id", userId).maybeSingle();
      // A PostgREST error response is not an authoritative profile read.
      // Success with no row, however, must supersede older in-flight results
      // without fabricating or restoring a deleted profile name.
      if (error) return;
      const user = get().user;
      if (epoch !== accountIdentityEpoch || readOrder <= profileAppliedReadOrder
        || writeOrder !== profileWriteOrder || !user || user.id !== userId) return;
      profileAppliedReadOrder = readOrder;
      const name = (data as { display_name?: string } | null)?.display_name;
      if (name) {
        confirmedProfileName = { userId, epoch, name };
        set({ user: { ...user, displayName: name } });
      } else {
        // An authoritative no-row result means the previous server profile
        // has disappeared. Do not carry its confirmed name into SDK refreshes.
        confirmedProfileName = undefined;
        const fallback = latestAuthFallback?.userId === userId && latestAuthFallback.epoch === epoch
          ? latestAuthFallback.name
          : user.email.split("@")[0] || "Learner";
        set({ user: { ...user, displayName: fallback } });
      }
    } catch {
      // Profile names are cosmetic; the account still works.
    }
  }

  /**
   * After an explicit sign-in on a device not yet linked to this account
   * (JD: "on sign in it should always load the most recent backup"): a device
   * with no work of its own takes the account's latest version at once (a
   * safety snapshot is saved first); a device with its own work keeps it and
   * gets the choice. Nothing on this device is ever uploaded here.
   */
  async function welcomeBack(): Promise<void> {
    const user = get().user;
    const epoch = accountIdentityEpoch;
    if (!user || linkStateFor(user.id) !== "unlinked") return;
    let latest: RevisionSummary | undefined;
    try {
      [latest] = await transport.summaries(1);
    } catch {
      return; // Offline or service trouble: the Account page still offers every option.
    }
    if (!latest || epoch !== accountIdentityEpoch || get().user?.id !== user.id) return;
    const state = useStore.getState();
    if (state.deferredContent?.sources.length || deviceHasOwnWork({ ...state, userSounds: 0 })) {
      set({ restoreOffer: latest, message: "" });
      return;
    }
    await get().restoreRevision(latest);
    if (epoch === accountIdentityEpoch && get().user?.id === user.id && !get().error) {
      set({ message: `Welcome back. Your AXOM from ${new Date(latest.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })} is on this device.` });
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
          // Only the first SDK event may confirm a boot without a cached session.
          // A later sign-in or A → B → A transition cannot claim the old vault.
          const initialScope = bootInitialSessionScope;
          bootInitialSessionScope = undefined;
          const resumeBootWorkspace = event === "INITIAL_SESSION" && initialScope
            && isQuestionAttachmentScopeCurrent(initialScope)
            && session?.user.id === bootLinkedAccountId;
          if (event === "PASSWORD_RECOVERY") {
            // Recovery is also an auth identity event. Never retain an earlier
            // account's history, devices or cloud receipt through this path.
            applySession(session);
            set({ phase: "recovering-password", message: "Choose a new password to finish recovery." });
            return;
          }
          applySession(session);
          if (resumeBootWorkspace) void resumeLinkedWorkspaceAfterHydration();
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
      if (result) {
        set({ pendingCodeEmail: undefined, pendingCodeKind: undefined, message: "Signed in. Nothing on this device has changed." });
        await welcomeBack();
      }
      return Boolean(result);
    },

    async signUp(email, password, displayName, communityPreferences) {
      const emailError = validateEmail(email) ?? validatePassword(password);
      if (emailError) { set({ error: emailError }); return false; }
      const result = await guarded("Creating your account…", async () => {
        const { data, error } = await (await client()).auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim().slice(0, 80) || useStore.getState().profile.name || "Learner",
              // The auth-user insert trigger persists this even when email confirmation
              // happens on another device. It never reapplies it to an existing account.
              axom_community_preferences: signupCommunityPreferences(communityPreferences),
            },
            emailRedirectTo: authRedirectUrl(),
          },
        });
        if (error) throw error;
        if (data.session) applySession(data.session);
        return data.session ? "signed-in" : "confirm";
      });
      if (result === "confirm") set({ pendingCodeEmail: email.trim(), pendingCodeKind: "signup", message: `We emailed a confirmation code to ${email.trim()}. Enter it below, or use the link in the email. Local work is unchanged.` });
      if (result === "signed-in") set({ pendingCodeEmail: undefined, pendingCodeKind: undefined, message: "Account created. Choose whether to protect this device’s workspace." });
      return Boolean(result);
    },

    async sendCode(email, communityPreferences) {
      const emailError = validateEmail(email);
      if (emailError) { set({ error: emailError }); return false; }
      const result = await guarded("Sending a sign-in code…", async () => {
        const { error } = await (await client()).auth.signInWithOtp({
          email: email.trim(),
          options: {
            shouldCreateUser: true,
            emailRedirectTo: authRedirectUrl(),
            data: { axom_community_preferences: signupCommunityPreferences(communityPreferences) },
          },
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
      else if (result) {
        set({ pendingCodeEmail: undefined, pendingCodeKind: undefined, message: "Signed in. Nothing on this device has changed." });
        await welcomeBack();
      }
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
      const profileEpoch = accountIdentityEpoch;
      if (!user || !displayName) return false;
      // The same ID after A → B → A is not the same authenticated session.
      // An earlier profile write may complete after the SDK has switched users.
      const sameOwner = () => profileEpoch === accountIdentityEpoch && get().user?.id === user.id;
      const assertOwner = () => {
        if (!sameOwner()) throw new Error("The signed-in account changed during the profile update.");
      };
      // Reserve this mutation's turn immediately, before any await.
      // Queueing the full pair avoids a completed later profile write being
      // contradicted by an earlier auth-metadata acknowledgement (or vice versa).
      const previousRename = profileRenameQueues.get(user.id) ?? Promise.resolve();
      let releaseRename!: () => void;
      const currentRename = new Promise<void>((resolve) => { releaseRename = resolve; });
      profileRenameQueues.set(user.id, currentRename);
      await previousRename;
      try {
        // A queued request must not begin writes after A → B → A.
        if (!sameOwner()) return false;
        const result = await guarded("Saving your name…", async () => {
          const supabase = await client();
          assertOwner();
          const { error } = await supabase.from("account_profiles").upsert({
            user_id: user.id, display_name: displayName, updated_at: new Date().toISOString(),
          });
          if (error) throw error;
          // The profile upsert is already acknowledged. Preserve its name even
          // if the separate auth-metadata update fails, and fence stale SELECTs.
          assertOwner();
          const current = get().user;
          if (!current) throw new Error("The signed-in account changed during the profile update.");
          profileWriteOrder += 1;
          confirmedProfileName = { userId: user.id, epoch: profileEpoch, name: displayName };
          set({ user: { ...current, displayName } });
          // Supabase can resolve { error } without rejecting its promise. A
          // partial write must never be reported as a fully completed rename.
          let authError: unknown;
          try {
            const response = await supabase.auth.updateUser({ data: { display_name: displayName } });
            authError = response.error;
          } catch (error) {
            authError = error;
          }
          assertOwner();
          if (authError) {
            throw new Error(`Name saved to your profile, but sign-in metadata was not updated. Retry saving your name to finish. ${friendlyError(authError)}`);
          }
          return true;
        }, sameOwner);
        // A late A request cannot reinstate A's name, busy state or notice on B.
        if (!sameOwner()) return false;
        if (result) set({ message: "Account name updated." });
        return Boolean(result);
      } finally {
        releaseRename();
        // Only remove the tail if no newer same-account save reserved a turn.
        // Different account queues remain independent throughout.
        if (profileRenameQueues.get(user.id) === currentRename) {
          profileRenameQueues.delete(user.id);
        }
      }
    },

    async signOut() {
      const initiatingUserId = get().user?.id;
      const initiatingEpoch = accountIdentityEpoch;
      const sameSession = () =>
        accountIdentityEpoch === initiatingEpoch && get().user?.id === initiatingUserId;
      // Supabase can emit SIGNED_OUT before auth.signOut() resolves. Accept
      // only that direct A → signed-out transition, not A → B or A → B → A.
      const sdkEndedThisSession = () =>
        accountIdentityEpoch === initiatingEpoch + 1
        && !get().user && get().phase === "signed-out";
      const canSettle = () => sameSession() || sdkEndedThisSession();
      let localRevocationWarning = "";
      const signedOut = await guarded("Signing out…", async () => {
        const supabase = await loadSupabase();
        // The SDK is global to the browser. A delayed load must never sign out
        // B when this request was started by A.
        if (!sameSession()) return false;
        if (!supabase && cloudConfigured()) throw new Error("The account service couldn’t load. Try again before signing out.");
        if (supabase) {
          // This action signs out only this device. Default Supabase scope is
          // global, which would also revoke other devices' refresh tokens.
          const { error } = await supabase.auth.signOut({ scope: "local" });
          if (error) {
            if (!sdkEndedThisSession()) throw error;
            // Local scope clears this device before attempting server
            // revocation. Complete app cleanup but do not claim that the
            // remote token was revoked when the server request failed.
            localRevocationWarning = `Signed out on this device, but server token revocation could not be confirmed. ${friendlyError(error)}`;
          }
        }
        if (!canSettle()) return false;
        coordinator?.dispose();
        return true;
      }, canSettle);
      if (!signedOut || !canSettle()) return;
      clearAccountUploadCaches();
      clearAccountSync();
      set({
        phase: cloudConfigured() ? "signed-out" : "unconfigured",
        user: null,
        link: "unlinked",
        ...protectionView("local-only"),
        history: [],
        devices: [],
        restoreOffer: undefined,
        pendingCodeEmail: undefined,
        pendingCodeKind: undefined,
        message: localRevocationWarning ? "" : "Signed out. This device’s workspace is still here.",
        error: localRevocationWarning,
      });
    },

    async linkThisDevice() {
      const user = get().user;
      if (!user) return;
      const scope = getQuestionAttachmentScope();
      const assertAdoptingAccount = () => {
        if (get().user?.id !== user.id || !isQuestionAttachmentScopeCurrent(scope)) {
          throw new Error("The account changed while selecting this device's workspace. Reopen Account before trying again.");
        }
      };
      await guarded("Protecting this device’s workspace…", async () => {
        const meta = read();
        if (!meta.accountUserId) {
          await adoptDeviceQuestionAttachments(user.id, workspaceMedia(useStore.getState()).keys());
          assertAdoptingAccount();
          await adoptDeviceSourceOriginals(user.id, contentMetadata(useStore.getState()).documents ?? []);
        }
        assertAdoptingAccount();
        // A newly linked device uploads against base 0. If the account already
        // holds work from another device, the server keeps BOTH and reports a
        // conflict for the learner to resolve — never a silent overwrite.
        write({ ...meta, accountUserId: user.id, baseRevision: meta.accountUserId === user.id ? meta.baseRevision : 0 });
        const status = await withCoordinator(async (active) => {
          active.queue();
          await active.flush("foundation");
          return active.currentStatus();
        });
        assertAdoptingAccount();
        // This explicit choice selects the local workspace even if the cloud
        // refuses its upload. Auth events and ordinary edits cannot mint it.
        recordWorkspaceHydration(user.id, useStore.getState().journal);
        set({ link: "linked", ...protectionView(status) });
        await transport.touchDevice({ deviceId: deviceId(), label: deviceLabel(), platform: platformName(), revision: read().baseRevision }).catch(() => undefined);
        set({
          message: status === "conflict"
            ? "Your account already has work from another device. Both versions are kept — choose which one continues."
            : status === "protected"
              ? "This workspace is protected. Changes now back up in the background."
              : protectionDetail(protectionView(status)) ?? "Your work is saved here and will upload when the account can be reached.",
        });
      });
      await get().refresh();
    },

    async syncNow() {
      const user = get().user;
      const syncEpoch = accountIdentityEpoch;
      if (!user || get().link !== "linked") return;
      const sameOwner = () => syncEpoch === accountIdentityEpoch && get().user?.id === user.id && get().link === "linked";
      const assertSyncOwner = () => {
        if (!sameOwner()) throw new Error("The signed-in account changed. Manual sync was stopped.");
      };
      const completedStatus = await guarded("Protecting now…", async () => {
        const status = await withCoordinator(async (active) => {
          assertSyncOwner();
          active.queue();
          await active.flush("manual");
          // Returning account A is not the same A session after A → B → A.
          assertSyncOwner();
          return active.currentStatus();
        });
        assertSyncOwner();
        set(protectionView(status));
        return status;
      }, sameOwner);
      // A prior Protected badge is not a receipt for this attempt. A failed
      // flush must never announce that it just protected new changes.
      if (!sameOwner()) return;
      set({ message: completedStatus === "protected" ? "Protected just now." : "" });
      void get().refresh();
    },

    async pullLatest() {
      const user = get().user;
      const pullEpoch = accountIdentityEpoch;
      const meta = read();
      if (!user || get().link !== "linked" || get().busy || get().applyingRemote || meta.pending || meta.conflictServerRevision !== undefined || !meta.lastHash) return;
      const before = useStore.getState();
      const sameOwner = () => pullEpoch === accountIdentityEpoch && get().user?.id === user.id;
      const unchanged = () => sameOwner() && useStore.getState() === before
        && !read().pending && read().baseRevision === meta.baseRevision;
      try {
        const current = await snapshotWorkspace(before, { deviceId: deviceId(), baseRevision: meta.baseRevision, reason: "automatic" });
        if (current.contentHash !== meta.lastHash && (await transport.prepare(current)).contentHash !== meta.lastHash) return;
        const [latest] = await transport.summaries(1);
        if (!latest || latest.revision <= meta.baseRevision) return;
        const revision = await transport.revision(latest.id);
        const next = parseImport(JSON.stringify(await retainDownloadedContent(revision.payload, before)));
        if (!unchanged()) return;
        await createLocalBackup(before.schemaVersion);
        if (!unchanged()) return;
        await transport.prepareMediaCache(revision, user.id);
        if (!unchanged()) return;
        const checkpoint = getVaultWriteCheckpoint();
        set({ applyingRemote: true });
        try {
          // The final account ID may again be A after an intervening B session.
          if (!unchanged()) return;
          useStore.getState().replaceAll(next, user.id);
        } finally {
          if (sameOwner()) set({ applyingRemote: false });
        }
        if (!sameOwner()) return;
        const applied = useStore.getState();
        write({ ...read(), baseRevision: latest.revision, pending: true, pendingIdempotencyKey: crypto.randomUUID() });
        await flushLocalVaultWrites();
        if (!sameOwner()) return;
        assertVaultWritesSince(checkpoint);
        const changed = useStore.getState() !== applied;
        if (!sameOwner()) return;
        write({ ...read(), baseRevision: latest.revision, lastHash: revision.contentHash, lastProtectedAt: latest.createdAt,
          pending: changed, pendingIdempotencyKey: changed ? crypto.randomUUID() : undefined, attempt: 0, lastError: undefined, nextAttemptAt: undefined });
        if (sameOwner()) set({ ...protectionView(restingStatus(read())), error: "" });
      } catch (error) {
        if (sameOwner()) set({ error: friendlyError(error), applyingRemote: false });
      }
    },

    async refresh() {
      const userId = get().user?.id;
      const epoch = accountIdentityEpoch;
      if (!userId) return;
      try {
        const [history, devices] = await Promise.all([
          transport.summaries(30),
          transport.devices(deviceId()).catch(() => [] as AccountDevice[]),
        ]);
        if (epoch === accountIdentityEpoch && get().user?.id === userId) set({ history, devices });
      } catch (error) {
        if (epoch === accountIdentityEpoch && get().user?.id === userId) set({ error: friendlyError(error) });
      }
    },

    async restoreRevision(summary) {
      const user = get().user;
      const restoreEpoch = accountIdentityEpoch;
      if (!user) return;
      await guarded("Restoring the protected version…", async () => {
        const previousState = useStore.getState();
        // Account ID alone is insufficient: A → B → A can finish with the
        // same ID while an earlier A restore is still downloading.
        const assertRestoreOwner = () => {
          if (restoreEpoch !== accountIdentityEpoch || get().user?.id !== user.id) {
            throw new Error("The signed-in account changed. Restore was stopped.");
          }
        };
        const assertRestoreWorkspace = () => {
          assertRestoreOwner();
          if (useStore.getState() !== previousState) {
            throw new Error("Your workspace changed while downloading. Try the restore again after finishing your edit.");
          }
        };
        const revision = await transport.revision(summary.id);
        assertRestoreWorkspace();
        const next = parseImport(JSON.stringify(await retainDownloadedContent(revision.payload, previousState)));
        assertRestoreWorkspace();
        await createLocalBackup(previousState.schemaVersion);
        assertRestoreWorkspace();
        await transport.prepareMediaCache(revision, user.id);
        assertRestoreWorkspace();
        const checkpoint = getVaultWriteCheckpoint();
        // Last synchronous guard before the first destructive workspace write.
        assertRestoreWorkspace();
        useStore.getState().replaceAll(next, user.id);
        await flushLocalVaultWrites();
        assertVaultWritesSince(checkpoint);
        assertRestoreOwner();
        recordRestoreEvent({ kind: "account-restore", detail: `Protected version #${summary.revision} from ${new Date(summary.createdAt).toLocaleString()}` });
        const latest = await transport.latestRevision().catch(() => summary.revision);
        assertRestoreOwner();
        write({ ...read(), accountUserId: user.id, baseRevision: latest, conflictServerRevision: undefined, pending: true, pendingIdempotencyKey: crypto.randomUUID() });
        const status = await withCoordinator(async (active) => {
          assertRestoreOwner();
          await active.flush("restore");
          assertRestoreOwner();
          return active.currentStatus();
        });
        assertRestoreOwner();
        set({
          link: "linked",
          ...protectionView(status),
          message: "Restored. A safety snapshot of the previous device state was saved first, and the restore is recorded as a new version.",
        });
      }, () => restoreEpoch === accountIdentityEpoch && get().user?.id === user.id);
      if (restoreEpoch === accountIdentityEpoch && get().user?.id === user.id) void get().refresh();
    },

    async keepThisDevice() {
      const server = get().conflictServerRevision ?? read().conflictServerRevision;
      if (server === undefined) return;
      await guarded("Keeping this device’s version…", async () => {
        const status = await withCoordinator(async (active) => {
          await active.keepThisDevice(server);
          return active.currentStatus();
        });
        set(protectionView(status));
      });
      set({ message: "This device’s version now continues. The other version stays in history." });
      void get().refresh();
    },

    async mergeWithAccount() {
      const user = get().user;
      const mergeEpoch = accountIdentityEpoch;
      if (!user) return;
      const sameOwner = () => mergeEpoch === accountIdentityEpoch && get().user?.id === user.id;
      const assertMergeOwner = () => {
        if (!sameOwner()) throw new Error("The signed-in account changed. Merge was stopped.");
      };
      await guarded("Merging this device with your account…", async () => {
        const [latest] = await transport.summaries(1);
        assertMergeOwner();
        if (!latest) throw new Error("No account version is available to merge with yet.");
        const revision = await transport.revision(latest.id);
        assertMergeOwner();
        const server = parseImport(JSON.stringify(revision.payload));
        await createLocalBackup(useStore.getState().schemaVersion);
        assertMergeOwner();
        await transport.prepareMediaCache(revision, user.id);
        assertMergeOwner();
        // Keep edits made while downloading, but never replace a workspace
        // that changes again after the final synchronous merge calculation.
        const beforeMerge = useStore.getState();
        const merged = mergeStates(beforeMerge, server);
        const checkpoint = getVaultWriteCheckpoint();
        assertMergeOwner();
        if (useStore.getState() !== beforeMerge) {
          throw new Error("Your workspace changed while merging. Try again after finishing your edit.");
        }
        useStore.getState().replaceAll(merged, user.id);
        assertMergeOwner();
        await flushLocalVaultWrites();
        assertMergeOwner();
        assertVaultWritesSince(checkpoint);
        set({ restoreOffer: undefined });
        recordRestoreEvent({ kind: "account-merge", detail: `Merged with protected version #${latest.revision}` });
        write({ ...read(), accountUserId: user.id, baseRevision: latest.revision, conflictServerRevision: undefined, pending: true, pendingIdempotencyKey: crypto.randomUUID() });
        const status = await withCoordinator(async (active) => {
          assertMergeOwner();
          await active.flush("manual");
          assertMergeOwner();
          return active.currentStatus();
        });
        assertMergeOwner();
        set({
          link: "linked",
          ...protectionView(status),
          message: "Merged. Both devices’ records are combined (newer copies win, nothing deleted) and saved as a new version. A safety snapshot was taken first.",
        });
      }, sameOwner);
      if (sameOwner()) void get().refresh();
    },

    async adoptAccountVersion() {
      const history = get().history.length ? get().history : await transport.summaries(1).catch(() => []);
      const latest = get().restoreOffer ?? history[0];
      if (!latest) { set({ error: "No account version is available yet." }); return; }
      await get().restoreRevision(latest);
      if (!get().error) set({ restoreOffer: undefined });
    },

    async keepDeviceWork() {
      // Link against base 0: the server keeps the account's version in
      // history and reports the conflict, which "keep" then resolves.
      await get().linkThisDevice();
      if (get().protection === "conflict") await get().keepThisDevice();
      if (!get().error) set({ restoreOffer: undefined });
    },

    async forgetDevice(id) {
      await guarded("Removing device…", async () => { await transport.forgetDevice(id); });
      void get().refresh();
    },

    async deleteCloudData() {
      const deleted = await guarded("Deleting cloud copies…", async () => {
        await transport.deleteCloudData();
        coordinator?.dispose();
        clearAccountUploadCaches();
        clearAccountSync();
        return true;
      });
      if (!deleted) return;
      set({ link: "unlinked", ...protectionView("local-only"), history: [], devices: [], message: "Every server copy was deleted. This device’s workspace is untouched." });
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
    paused: "Retrying later",
    blocked: "Not protected",
    conflict: "Action needed",
  }[status];
}

/**
 * One plain sentence about why protection is not up to date and what happens
 * next, or null when there is nothing to explain.
 */
export function protectionDetail(view: Pick<AccountState, "protection" | "syncFailure" | "nextAttemptAt">): string | null {
  const { protection, syncFailure, nextAttemptAt } = view;
  if (protection !== "retrying" && protection !== "paused" && protection !== "blocked") return null;
  const saved = "Your work is saved on this device.";
  const next = nextAttemptAt && Date.parse(nextAttemptAt) > Date.now()
    ? ` AXOM tries again by itself around ${new Date(nextAttemptAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
    : "";
  if (protection === "blocked") {
    if (syncFailure?.rejection === "too-large") {
      return `The prepared account record exceeds its 14 MB limit, so this version is not uploading. ${saved} Remove or export large local items, then choose Protect now. Emergency recovery can still export all of it.`;
    }
    if (syncFailure?.rejection === "workspace-too-large") {
      return `This workspace exceeds the safe account restore size before AXOM can prepare an upload. ${saved} Keep a portable copy in Emergency recovery, then review large source files before trying again.`;
    }
    if (syncFailure?.rejection === "source-too-large") {
      return `One source exceeds the account's 8 MB compressed file limit. ${saved} Keep a portable copy, then split that source into smaller files before trying again.`;
    }
    if (syncFailure?.rejection === "preparation-failed") {
      return `AXOM could not prepare this workspace for account protection. ${saved} Keep a portable copy in Emergency recovery, then try again after updating AXOM.`;
    }
    if (syncFailure?.rejection === "missing-original") {
      return `An original source file is missing on this device. ${saved} Restore the exact file from a complete backup before trying again.`;
    }
    if (syncFailure?.rejection === "missing-image") {
      return `A question image is missing on this device. ${saved} Restore a complete backup with its images before trying again.`;
    }
    if (syncFailure?.rejection === "unsupported-image") {
      return `A question image has a type or size the account cannot store. ${saved} Keep a portable copy and review the image before trying again.`;
    }
    if (syncFailure?.rejection === "too-many-images") {
      return `This version contains more images than the account can protect at once. ${saved} Keep a portable copy and review the image library before trying again.`;
    }
    if (syncFailure?.rejection === "local-content-conflict") {
      return `Two source copies on this device conflict, so AXOM stopped before uploading. ${saved} Keep a portable copy and review the downloaded course content before trying again.`;
    }
    if (syncFailure?.rejection === "account-mismatch") {
      return `This device's workspace is linked to a different account. ${saved} Check which account you signed in to before trying again.`;
    }
    if (syncFailure?.rejection === "source-account-mismatch") {
      return `Some source content belongs to a different account. ${saved} Sign in to its original account and download the content before trying again.`;
    }
    if (syncFailure?.rejection === "storage-limit") {
      return `Your account’s version history is full, so it refused this upload and AXOM stopped repeating it. ${saved}${next}`;
    }
    return `Your account refused this upload, so AXOM stopped repeating it. ${saved} Updating AXOM may help.${next}`;
  }
  if (syncFailure?.kind === "auth") {
    return `Your account could not confirm this sign-in. ${saved} If this continues, sign out and sign in again.${next}`;
  }
  if (syncFailure?.kind === "server" && syncFailure.code === "57014") {
    return `The account service took too long to finish this save. ${saved} AXOM has not confirmed a new protected version.${next}`;
  }
  return protection === "paused"
    ? `AXOM could not reach your account after several tries, so it now checks less often. ${saved}${next}`
    : `AXOM could not reach your account. ${saved}${next}`;
}

/** The last failed upload in technical terms, for the Technical details disclosure. */
export function failureSummary(view: Pick<AccountState, "syncFailure" | "nextAttemptAt" | "snapshotBytes">): string {
  const failure = view.syncFailure;
  if (!failure) return "";
  const what = failure.kind === "rejected" ? `refused (${failure.rejection ?? "refused"})` : failure.kind;
  const answer = failure.status ? `HTTP ${failure.status}` : failure.kind === "rejected" ? "stopped on this device" : "no answer";
  const size = view.snapshotBytes ? ` Snapshot size ${(view.snapshotBytes / 1_000_000).toFixed(1)} MB.` : "";
  const phase = failure.phase ? ` Stage: ${failure.phase}.` : "";
  const reason = failure.reason ? ` Cause: ${failure.reason}.` : "";
  const next = view.nextAttemptAt ? ` Next automatic try ${new Date(view.nextAttemptAt).toLocaleString()}.` : "";
  return `Last upload failed ${new Date(failure.at).toLocaleString()}: ${what}, ${answer}${failure.code ? `, code ${failure.code}` : ""}.${phase}${reason}${size}${next}`;
}

// Install before any image I/O. Capture the existing link once; a later
// account must never acquire ambiguous legacy bytes by being the next reader.
initializeQuestionAttachmentScope(useAccount.getState().user?.id, read().accountUserId);
useAccount.subscribe(state => setQuestionAttachmentAccount(state.user?.id));

/** Boot-only activation of the device's previously linked, successfully loaded
 * vault. Ordinary sign-in/profile changes never call this boundary. */
export async function resumeLinkedWorkspaceAfterHydration(): Promise<boolean> {
  const initial = useAccount.getState();
  const accountId = initial.user?.id;
  const linkedAccountId = read().accountUserId;
  const scope = getQuestionAttachmentScope();
  if (initial.phase !== "signed-in" || !accountId || linkedAccountId !== accountId) return false;
  try {
    await storeHydration.wait();
  } catch {
    // Startup reports vault failures; they must never issue an ownership receipt.
    return false;
  }
  const current = useAccount.getState();
  if (!useStore.persist.hasHydrated() || !isQuestionAttachmentScopeCurrent(scope)
    || current.phase !== "signed-in" || current.user?.id !== accountId
    || read().accountUserId !== linkedAccountId) return false;
  recordWorkspaceHydration(accountId, useStore.getState().journal);
  return true;
}

const bootAccount = useAccount.getState();
if (bootAccount.phase === "signed-in" && bootAccount.user?.id === bootLinkedAccountId) {
  void resumeLinkedWorkspaceAfterHydration();
} else if (bootAccount.phase === "loading" && !bootAccount.user) {
  bootInitialSessionScope = getQuestionAttachmentScope();
}
