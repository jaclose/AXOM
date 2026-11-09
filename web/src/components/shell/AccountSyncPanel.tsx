import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  AlertTriangle, BadgeCheck, ChevronDown, Cloud, CloudOff, Download, GitMerge, HardDrive, History,
  KeyRound, Laptop, LogOut, Mail, RefreshCw, RotateCcw, ShieldCheck, Smartphone, Trash2, UserPlus,
} from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton, Tag } from "../ui/primitives";
import {
  PASSWORD_MIN_LENGTH,
  failureSummary,
  protectionDetail,
  protectionLabel,
  useAccount,
  type AccountUser,
  type CommunitySignupPreferences,
} from "../../lib/account/accountStore";
import type { AccountDevice, ProtectionStatus, RevisionSummary } from "../../lib/sync/syncTypes";
import { useStore } from "../../lib/store";
import { readVaultWriteFailure } from "../../lib/vaultActivity";
import { subscribeVault, useLastVaultWrite } from "./SettingsSections";
import { TechnicalDetails } from "./TechnicalDetails";
import { CommunityPreferenceFields, CommunityPreferencesSettings } from "../community/CommunityPreferences";
import { SYNC_PHASE_LABELS, useSyncProgress } from "../../lib/sync/syncProgress";

type AuthMode = "sign-in" | "create" | "code" | "forgot";

const PROTECTION_HEADING: Record<ProtectionStatus, string> = {
  "local-only": "Cloud protection is starting.",
  "saved-locally": "Latest changes are waiting.",
  syncing: "Protecting your latest work.",
  protected: "Your account copy is current.",
  offline: "Your account is offline.",
  retrying: "Trying to reconnect.",
  paused: "Protection is retrying later.",
  blocked: "The account copy could not update.",
  conflict: "Two versions need a decision.",
};

/**
 * Settings → Account. Every state is explicit: not configured, signed out,
 * password recovery, signed in (unlinked / linked / linked to another account),
 * and conflict. Local work is always legitimate; nothing uploads or replaces
 * without a deliberate choice.
 */
export function AccountSyncPanel({ onOpenBackup, onOpenCommunity }: { onOpenBackup?: () => void; onOpenCommunity?: () => void }) {
  const account = useAccount();
  const progress = useSyncProgress(state => state.current?.accountId === account.user?.id ? state.current : null);
  const protectionActions = useRef<HTMLDivElement>(null);
  useEffect(() => { useAccount.getState().init(); }, []);
  useEffect(() => {
    if (account.phase === "signed-in") void useAccount.getState().refresh();
  }, [account.phase, account.user?.id]);

  return (
    <div className="account-center">
      <div className="account-stage">
        <AccountHero user={account.user} status={progress ? "syncing" : account.protection} phase={account.phase} lastProtectedAt={account.lastProtectedAt} />
        <div className="account-stage-work" ref={protectionActions}>
          {account.phase === "unconfigured" && <UnconfiguredCard onOpenBackup={onOpenBackup} />}
          {account.phase === "loading" && <div className="account-loading" role="status">Checking your account…</div>}
          {account.phase === "signed-out" && <AuthCard />}
          {account.phase === "recovering-password" && <PasswordRecoveryCard />}
          {account.phase === "signed-in" && account.user && <ProtectionCard onOpenBackup={onOpenBackup} />}
        </div>
      </div>

      {account.phase === "signed-in" && account.user && (
        <div className="account-management">
          <div className="account-disclosures" aria-label="Account details">
            <VersionsCard history={account.history} />
            <DevicesCard devices={account.devices} />
          </div>
          <IdentityCard user={account.user} />
        </div>
      )}

      {account.phase === "signed-in" && account.user && <CommunityPreferencesSettings accountId={account.user.id} onOpenCommunity={onOpenCommunity}
        onReviewWorkspace={() => protectionActions.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()} />}

      {(account.message || account.error) && (
        <div className={`account-notice ${account.error ? "error" : ""}`} role={account.error ? "alert" : "status"}>
          {account.error ? <AlertTriangle size={ICON_SIZE.body} aria-hidden="true" /> : <Cloud size={ICON_SIZE.body} aria-hidden="true" />}
          <span>{account.error || account.message}</span>
        </div>
      )}

      <div className="account-secondary">
        {account.phase !== "unconfigured" && <p className="account-footnote"><HardDrive size={ICON_SIZE.body} aria-hidden="true" /> Portable copies are always available in Emergency recovery.</p>}
        <TechnicalDetails>
          {account.phase === "unconfigured" && (
            <p>This build has no cloud credentials configured, so sign-in and cloud copies are switched off. Local autosave and manual JSON recovery are unchanged.</p>
          )}
          <p>
            Portable backups work with or without an account. New protected versions keep source content and question images in private account storage. Images download as you open them and remain available offline after downloading. Older protected versions may require a portable media backup.
          </p>
          {account.syncFailure && <p>{failureSummary(account)}</p>}
        </TechnicalDetails>
        {account.phase === "signed-in" && <DangerCard />}
      </div>
    </div>
  );
}

function AccountHero({ user, status, phase, lastProtectedAt }: {
  user: AccountUser | null;
  status: ProtectionStatus;
  phase: string;
  lastProtectedAt?: string;
}) {
  const lastWrite = useLastVaultWrite();
  const writeFailure = useSyncExternalStore(subscribeVault, readVaultWriteFailure, () => null);
  const localState = writeFailure ? "failure" : lastWrite ? "saved" : "pending";
  return (
    <section className={`account-overview status-${status} local-${localState}`} aria-label="Where your work is saved">
      <div className="account-overview-heading">
        <div>
          <span className="account-eyebrow">Save map</span>
          <h5>{writeFailure ? "Local saving needs attention." : "Where your work lives."}</h5>
          <p>{writeFailure ? "Keep AXOM open while you resolve the local save. Your account copy may also be behind." : "Your device holds your working copy. An account can hold a second, protected version."}</p>
        </div>
      </div>
      <div className="account-location-track" aria-label="Where your work is saved">
        <div className="account-location" role={writeFailure ? "alert" : "status"} aria-label="Local save status">
          <span className="account-location-icon"><HardDrive size={ICON_SIZE.control} aria-hidden="true" /></span>
          <div>
            <span className="account-location-label">01 / This device</span>
            <strong>{writeFailure ? "Save needs attention" : lastWrite ? "Last confirmed save" : "Waiting for first save"}</strong>
            {writeFailure && <small>Not saved since {new Date(writeFailure).toLocaleTimeString()}. Keep this window open.</small>}
            {!writeFailure && lastWrite && <small>{new Date(lastWrite.at).toLocaleTimeString()}{lastWrite.target === "local-fallback" ? " in browser fallback storage" : ""}</small>}
          </div>
          <span className={`account-location-indicator local-${localState}`} aria-hidden="true" />
        </div>
        <span className="account-location-bridge" aria-hidden="true" />
        <div className="account-location">
          <span className="account-location-icon">{status === "local-only" ? <CloudOff size={ICON_SIZE.control} aria-hidden="true" /> : <Cloud size={ICON_SIZE.control} aria-hidden="true" />}</span>
          <div>
            <span className="account-location-label">02 / Account copy</span>
            <strong>{phase === "unconfigured" ? "Unavailable in this build" : !user ? "Not connected" : protectionLabel(status)}</strong>
            {user && lastProtectedAt && <small>Last protected {relativeTime(lastProtectedAt)}</small>}
          </div>
          <span className={`account-location-indicator ${status}`} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

function UnconfiguredCard({ onOpenBackup }: { onOpenBackup?: () => void }) {
  return (
    <section className="account-action-panel account-unavailable">
      <div className="account-action-icon"><CloudOff size={ICON_SIZE.display} aria-hidden="true" /></div>
      <div className="account-action-copy">
        <span className="account-eyebrow">Accounts aren’t available in this version</span>
        <h5>Keep a portable copy.</h5>
        <p>Export, restore, or merge a portable copy in Emergency recovery.</p>
      </div>
      {onOpenBackup && <div className="account-form-actions"><GButton variant="primary" onClick={onOpenBackup}><Download size={ICON_SIZE.body} aria-hidden="true" /> Open Emergency recovery</GButton></div>}
    </section>
  );
}

function AuthCard() {
  const { busy, signIn, signUp, sendCode, verifyCode, requestPasswordReset, pendingCodeEmail, pendingCodeKind, clearNotice } = useAccount();
  const profileName = useStore((state) => state.profile.name);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(profileName ?? "");
  const [code, setCode] = useState("");
  const [communityPreferences, setCommunityPreferences] = useState<CommunitySignupPreferences>({ discoverable: false, shareMode: "off" });

  function choose(next: AuthMode) {
    setMode(next);
    setCode("");
    useAccount.setState({ pendingCodeEmail: undefined, pendingCodeKind: undefined });
    clearNotice();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pendingCodeEmail) await verifyCode(pendingCodeEmail, code);
    else if (mode === "sign-in") await signIn(email, password);
    else if (mode === "create") await signUp(email, password, displayName, communityPreferences);
    else if (mode === "forgot") await requestPasswordReset(email);
    else await sendCode(email, communityPreferences);
  }

  return (
    <section className="account-auth-layout" aria-label="Account access">
      <div className="account-auth-intro">
        <span className="account-eyebrow">Optional account</span>
        <h5>Make a second copy.</h5>
        <p>Recover your work here or continue on another device.</p>
        <div className="account-auth-promise"><ShieldCheck size={ICON_SIZE.emphasis} aria-hidden="true" /><span>Your local workspace stays here until you choose to protect it.</span></div>
      </div>
      <div className="account-auth-content">
        <div className="account-auth-topline">
          <span>{pendingCodeEmail ? "Verify your email" : mode === "forgot" ? "Password recovery" : mode === "create" ? "Create an account" : mode === "code" ? "Sign in with a code" : "Welcome back"}</span>
          <span>Account access</span>
        </div>
        {!pendingCodeEmail && mode !== "forgot" && (
          <div className="account-auth-methods" role="group" aria-label="Account access method">
            {([
              ["sign-in", "Sign in", KeyRound],
              ["create", "Create", UserPlus],
              ["code", "Email code", Mail],
            ] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" aria-pressed={mode === id} className={mode === id ? "on" : ""} onClick={() => choose(id)} disabled={busy}>
                <Icon size={ICON_SIZE.body} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        )}
        <form className="account-form" onSubmit={(event) => void submit(event)}>
        {mode === "create" && !pendingCodeEmail && (
          <label>
            <span>Name on your account</span>
            <input className="field" name="displayName" value={displayName} maxLength={80} autoComplete="name" onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        )}
        {!pendingCodeEmail && (
          <label>
            <span>Email</span>
            <input className="field" name="email" type="email" required autoComplete="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
        )}
        {!pendingCodeEmail && (mode === "sign-in" || mode === "create") && (
          <label>
            <span>Password</span>
            <input
              className="field"
              name="password"
              type="password"
              required
              minLength={mode === "create" ? PASSWORD_MIN_LENGTH : undefined}
              autoComplete={mode === "create" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === "create" && <small>At least {PASSWORD_MIN_LENGTH} characters with letters and a number.</small>}
          </label>
        )}
        {pendingCodeEmail && (
          <label>
            <span>{pendingCodeKind === "signup" ? "Confirmation code" : pendingCodeKind === "recovery" ? "Password reset code" : "Sign-in code"} sent to {pendingCodeEmail}</span>
            <input className="field account-code" name="code" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} required maxLength={10} value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
        )}
        {!pendingCodeEmail && (mode === "create" || mode === "code") && (
          <section className="community-preferences community-preferences-signup" aria-label="Community and leaderboards">
            <h6>Community &amp; leaderboards</h6>
            <p className="community-preferences-help">{mode === "code" ? "If this email creates a new account, use these choices. Existing accounts keep their saved choices." : "Optional. Choose a handle in Community before sharing starts. You can change these choices in Account Settings."}</p>
            <CommunityPreferenceFields value={communityPreferences} onChange={setCommunityPreferences} disabled={busy} />
          </section>
        )}
        <div className="account-form-actions">
          <GButton className="account-submit" variant="primary" type="submit" disabled={busy}>
            {busy ? "Working…" : pendingCodeEmail ? "Verify code" : mode === "sign-in" ? "Sign in" : mode === "create" ? "Create account" : mode === "forgot" ? "Send reset code" : "Send code"}
          </GButton>
          {!pendingCodeEmail && mode === "sign-in" && <button type="button" className="account-link" onClick={() => choose("forgot")}>Forgot password?</button>}
          {!pendingCodeEmail && mode === "forgot" && <button type="button" className="account-link" onClick={() => choose("sign-in")}>Back to sign in</button>}
          {pendingCodeEmail && <button type="button" className="account-link" onClick={() => choose(mode === "forgot" ? "sign-in" : mode)}>Use a different email</button>}
        </div>
        {(mode === "code" || pendingCodeEmail) && <p className="account-form-note">Codes work in the browser and the desktop app.</p>}
      </form>
      </div>
    </section>
  );
}

function PasswordRecoveryCard() {
  const { busy, updatePassword } = useAccount();
  const [password, setPassword] = useState("");
  return (
    <section className="account-form-panel account-recovery-panel">
      <div className="account-card-head">
        <KeyRound size={ICON_SIZE.emphasis} aria-hidden="true" />
        <div><h5>Set a new password</h5><p>You opened a password-reset link. Choose a new password to finish.</p></div>
      </div>
      <form className="account-form" onSubmit={(event) => { event.preventDefault(); void updatePassword(password); }}>
        <label>
          <span>New password</span>
          <input className="field" name="newPassword" type="password" required autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <div className="account-form-actions"><GButton variant="primary" type="submit" disabled={busy}>Save password</GButton></div>
      </form>
    </section>
  );
}

function IdentityCard({ user }: { user: AccountUser }) {
  const { busy, updateDisplayName, signOut } = useAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.displayName);
  useEffect(() => { setName(user.displayName); }, [user.displayName]);
  return (
    <section className="account-identity" aria-label="Account identity">
      <div className="account-identity-avatar" aria-hidden="true">{user.displayName.trim().charAt(0).toUpperCase() || "A"}</div>
      <div className="account-identity-main">
        {editing ? (
          <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void updateDisplayName(name).then((ok) => ok && setEditing(false)); }}>
            <input className="field" aria-label="Account name" name="accountName" autoComplete="name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus />
            <GButton size="sm" variant="primary" type="submit" disabled={busy}>Save</GButton>
            <GButton size="sm" type="button" onClick={() => { setEditing(false); setName(user.displayName); }}>Cancel</GButton>
          </form>
        ) : (
          <div className="account-identity-name">
            <b>{user.displayName}</b>
            <button type="button" className="account-link" onClick={() => setEditing(true)}>Edit name</button>
          </div>
        )}
        <div className="account-identity-meta">
          <span>{user.email}</span>
          {user.emailConfirmed
            ? <span className="account-verified"><BadgeCheck size={ICON_SIZE.microInline} aria-hidden="true" /> Verified</span>
            : <span className="account-unverified">Email not confirmed yet</span>}
          {user.createdAt && <span>Member since {new Date(user.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>}
        </div>
      </div>
      <GButton size="sm" onClick={() => void signOut()} disabled={busy}><LogOut size={ICON_SIZE.body} aria-hidden="true" /> Sign out</GButton>
    </section>
  );
}

function ProtectionCard({ onOpenBackup }: { onOpenBackup?: () => void }) {
  const { user, link, protection: savedProtection, lastProtectedAt, conflictServerRevision, syncFailure, nextAttemptAt, busy, linkThisDevice, syncNow, keepThisDevice, adoptAccountVersion, mergeWithAccount, signOut, restoreOffer, keepDeviceWork } = useAccount();
  const progress = useSyncProgress(state => state.current?.accountId === user?.id ? state.current : null);
  const attention = useSyncProgress(state => state.attention?.accountId === user?.id ? state.attention : null);
  const protection = progress ? "syncing" : savedProtection;
  if (restoreOffer && link === "unlinked") {
    const saved = new Date(restoreOffer.createdAt).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    return (
      <section className="account-decision account-welcome" aria-labelledby="account-welcome-title">
        <div className="account-decision-head">
          <span className="account-eyebrow">Choose your starting point</span>
          <h5 id="account-welcome-title">Welcome back.</h5>
          <p>Your account has a version from {saved}. This device has work of its own. Both remain recoverable while you choose what continues.</p>
        </div>
        <div className="account-option-list">
          <button type="button" className="account-option featured" onClick={() => void adoptAccountVersion()} disabled={busy}>
            <span className="account-option-icon"><Download size={ICON_SIZE.control} aria-hidden="true" /></span>
            <span><b>Use the account version</b><small>Bring the saved version here. This device’s work stays recoverable in Emergency recovery.</small></span>
          </button>
          <button type="button" className="account-option" onClick={() => void mergeWithAccount()} disabled={busy}>
            <span className="account-option-icon"><GitMerge size={ICON_SIZE.control} aria-hidden="true" /></span>
            <span><b>Merge both</b><small>Keep both sets of work. Where the same item differs, the newer copy wins.</small></span>
          </button>
          <button type="button" className="account-option" onClick={() => void keepDeviceWork()} disabled={busy}>
            <span className="account-option-icon"><Laptop size={ICON_SIZE.control} aria-hidden="true" /></span>
            <span><b>Keep this device’s work</b><small>Continue here. The account version stays in history.</small></span>
          </button>
        </div>
      </section>
    );
  }
  if (link === "linked-elsewhere") {
    return (
      <section className="account-action-panel account-warning">
        <div className="account-action-icon"><AlertTriangle size={ICON_SIZE.display} aria-hidden="true" /></div>
        <div className="account-action-copy">
          <span className="account-eyebrow">Account mismatch</span>
          <h5>This device belongs to a different account</h5>
          <p>The workspace here was protected by another AXOM account. Sign out to return to that account, or protect this work with this one. Both accounts keep their own copies.</p>
        </div>
        <div className="account-form-actions">
          <GButton variant="primary" onClick={() => void linkThisDevice()} disabled={busy}>Protect with this account</GButton>
          <GButton onClick={() => void signOut()} disabled={busy}>Sign out</GButton>
        </div>
      </section>
    );
  }
  if (link === "unlinked") {
    return (
      <section className="account-action-panel account-cta">
        <div className="account-action-icon"><ShieldCheck size={ICON_SIZE.display} aria-hidden="true" /></div>
        <div className="account-action-copy">
          <span className="account-eyebrow">Ready to protect</span>
          <h5>Keep a second copy.</h5>
          <p>Protect this device’s workspace now, then save changes in the background. If your account already has work elsewhere, you will choose which version continues.</p>
        </div>
        <div className="account-form-actions">
          <GButton variant="primary" onClick={() => void linkThisDevice()} disabled={busy}><ShieldCheck size={ICON_SIZE.body} aria-hidden="true" /> Protect this workspace</GButton>
        </div>
      </section>
    );
  }
  if (protection === "conflict") {
    return (
      <section className="account-decision account-warning">
        <div className="account-decision-head">
          <span className="account-eyebrow">Action needed</span>
          <h5>Two versions need a decision.</h5>
          <p>Your account moved ahead on another device{conflictServerRevision ? ` (version #${conflictServerRevision})` : ""} while this device had changes. Both are stored. Choose which continues; the other stays in history.</p>
        </div>
        <div className="account-option-list">
          <button type="button" className="account-option featured" onClick={() => void mergeWithAccount()} disabled={busy}>
            <span className="account-option-icon"><GitMerge size={ICON_SIZE.control} aria-hidden="true" /></span>
            <span><b>Merge both <Tag tone="green">Recommended</Tag></b><small>Combine records from both versions. Newer copies win; items deleted on one device may reappear.</small></span>
          </button>
          <button type="button" className="account-option" onClick={() => void keepThisDevice()} disabled={busy}>
            <span className="account-option-icon"><Laptop size={ICON_SIZE.control} aria-hidden="true" /></span>
            <span><b>Keep this device</b><small>Upload this workspace as the newest version.</small></span>
          </button>
          <button type="button" className="account-option" onClick={() => void adoptAccountVersion()} disabled={busy}>
            <span className="account-option-icon"><Download size={ICON_SIZE.control} aria-hidden="true" /></span>
            <span><b>Use the account version</b><small>Bring the newest protected version here. AXOM saves a safety snapshot first.</small></span>
          </button>
        </div>
      </section>
    );
  }
  // Why protection is behind and what happens next. Null while everything is fine.
  const detail = protectionDetail({ protection, syncFailure, nextAttemptAt })
    ?? (protection === "offline" ? "Your work is saved on this device. AXOM will protect it when the connection returns." : null);
  return (
    <section className={`account-sync-panel account-protection status-${protection}`} aria-label="Cloud protection status">
      <div className="account-sync-main">
        <div className="account-sync-emblem"><Cloud size={ICON_SIZE.display} aria-hidden="true" /></div>
        <div className="account-sync-copy">
          <span className="account-eyebrow">Account copy</span>
          <h5>{PROTECTION_HEADING[protection]}</h5>
          <p>{lastProtectedAt ? `Last protected ${new Date(lastProtectedAt).toLocaleString()}` : "Waiting for the first protected version."}</p>
          {progress && <p role="status">{SYNC_PHASE_LABELS[progress.phase]}{progress.total !== undefined && progress.total > 0 ? ` · ${progress.completed ?? 0} of ${progress.total}` : "…"}</p>}
        </div>
      </div>
      <div className="account-sync-action">
        <b className={`account-sync-state ${protection}`}><span className="account-status-dot" aria-hidden="true" />{protectionLabel(protection)}</b>
        <GButton variant={detail ? "primary" : "default"} onClick={() => void syncNow()} disabled={busy || protection === "syncing"}>
          <RefreshCw size={ICON_SIZE.body} aria-hidden="true" className={protection === "syncing" ? "spin" : ""} /> {protection === "syncing" ? "Protecting…" : detail ? "Try again" : "Protect now"}
        </GButton>
      </div>
      {detail && <p className="account-sync-issue account-protection-detail" role="status"><AlertTriangle size={ICON_SIZE.body} aria-hidden="true" />{detail}</p>}
      {attention && attention.images.length > 0 && <div className="account-protection-detail" role="alert">
        <p>Restore these question images from a complete backup to finish protecting this workspace. Your questions and progress remain on this device.</p>
        <ul>{attention.images.slice(0, 5).map((image, index) => <li key={`${image.questionId}:${index}`}><b>{image.fileName}</b>: {image.questionLabel}</li>)}</ul>
        {attention.images.length > 5 && <p>And {attention.images.length - 5} more images.</p>}
        {onOpenBackup && <GButton onClick={onOpenBackup}><Download size={ICON_SIZE.body} aria-hidden="true" /> Open Emergency recovery</GButton>}
      </div>}
    </section>
  );
}

function VersionsCard({ history }: { history: RevisionSummary[] }) {
  const { busy, refresh, restoreRevision, link } = useAccount();
  if (link !== "linked" && !history.length) return null;
  return (
    <details className="account-disclosure">
      <summary>
        <span className="account-disclosure-icon"><History size={ICON_SIZE.control} aria-hidden="true" /></span>
        <span className="account-disclosure-label"><strong>Protected versions</strong><small>{history.length ? `${history.length} available to restore` : "No versions yet"}</small></span>
        <ChevronDown size={ICON_SIZE.body} className="account-disclosure-chevron" aria-hidden="true" />
      </summary>
      <div className="account-disclosure-body">
        <div className="account-section-head">
          <p>Newest first. Restoring saves a safety snapshot of this device first.</p>
          <GButton size="sm" onClick={() => void refresh()} disabled={busy}><RefreshCw size={ICON_SIZE.body} aria-hidden="true" /> Refresh</GButton>
        </div>
        {history.length === 0 ? (
          <p className="account-empty">Your first protected version will appear here.</p>
        ) : (
          <ol className="account-version-list">
            {history.map((item, index) => (
              <li key={item.id}>
                <span className="account-version-number">#{item.revision}</span>
                <div>
                  <b>{new Date(item.createdAt).toLocaleString()}</b>
                  <small>{reasonLabel(item.reason)} · schema v{item.schemaVersion}{index === 0 ? " · latest" : ""}</small>
                </div>
                <GButton size="tiny" onClick={() => {
                  if (confirm(`Replace this device’s workspace with version #${item.revision}? AXOM saves a safety snapshot first and records the restore as a new version.`)) {
                    void restoreRevision(item);
                  }
                }} disabled={busy}><RotateCcw size={ICON_SIZE.microInline} aria-hidden="true" /> Restore</GButton>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

function DevicesCard({ devices }: { devices: AccountDevice[] }) {
  const { busy, forgetDevice } = useAccount();
  if (!devices.length) return null;
  return (
    <details className="account-disclosure">
      <summary>
        <span className="account-disclosure-icon"><Laptop size={ICON_SIZE.control} aria-hidden="true" /></span>
        <span className="account-disclosure-label"><strong>Devices</strong><small>{devices.length} {devices.length === 1 ? "device" : "devices"} on this account</small></span>
        <ChevronDown size={ICON_SIZE.body} className="account-disclosure-chevron" aria-hidden="true" />
      </summary>
      <div className="account-disclosure-body">
        <p>Where this account has been used recently.</p>
        <ul className="account-device-list">
          {devices.map((device) => (
            <li key={device.deviceId}>
              {device.platform === "desktop" ? <Laptop size={ICON_SIZE.body} aria-hidden="true" /> : <Smartphone size={ICON_SIZE.body} aria-hidden="true" />}
              <div>
                <b>{device.label}{device.current && <Tag tone="cyan">This device</Tag>}</b>
                <small>Seen {relativeTime(device.lastSeenAt)}{device.lastProtectedRevision ? ` · version #${device.lastProtectedRevision}` : ""}</small>
              </div>
              {!device.current && <GButton size="tiny" onClick={() => void forgetDevice(device.deviceId)} disabled={busy}>Remove</GButton>}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function DangerCard() {
  const { busy, deleteCloudData, link } = useAccount();
  if (link !== "linked") return null;
  return (
    <details className="account-danger">
      <summary><ChevronDown size={ICON_SIZE.body} aria-hidden="true" /> Delete cloud copies</summary>
      <div className="account-danger-body">
        <p>Removes every protected version, shared question set, and device record from the server. This device’s workspace stays here, and you can protect it again later.</p>
        <GButton size="sm" variant="danger" disabled={busy} onClick={() => {
          if (confirm("Delete every server copy of your AXOM workspace? Local data on this device stays. This cannot be undone.")) void deleteCloudData();
        }}><Trash2 size={ICON_SIZE.body} aria-hidden="true" /> Delete cloud copies</GButton>
      </div>
    </details>
  );
}

function reasonLabel(reason: string): string {
  return ({
    foundation: "First protection",
    automatic: "Background backup",
    manual: "Protected manually",
    pre_restore: "Before a restore",
    restore: "Restore",
  } as Record<string, string>)[reason] ?? reason;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "recently";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
