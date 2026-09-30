import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle, BadgeCheck, Cloud, CloudOff, Download, GitMerge, History, KeyRound, Laptop, LogOut, Mail,
  RefreshCw, RotateCcw, ShieldCheck, Smartphone, Trash2, UserPlus,
} from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton, Tag } from "../ui/primitives";
import {
  PASSWORD_MIN_LENGTH,
  protectionLabel,
  useAccount,
  type AccountUser,
} from "../../lib/account/accountStore";
import type { AccountDevice, ProtectionStatus, RevisionSummary } from "../../lib/sync/syncTypes";
import { useStore } from "../../lib/store";
import { TechnicalDetails } from "./TechnicalDetails";

type AuthMode = "sign-in" | "create" | "code" | "forgot";

const STATUS_TONE: Record<ProtectionStatus, "green" | "red" | "orange" | "neutral" | "cyan"> = {
  "local-only": "neutral",
  "saved-locally": "cyan",
  syncing: "cyan",
  protected: "green",
  offline: "orange",
  retrying: "orange",
  conflict: "red",
};

/**
 * Settings → Account. Every state is explicit: not configured, signed out,
 * password recovery, signed in (unlinked / linked / linked to another account),
 * and conflict. Local work is always legitimate; nothing uploads or replaces
 * without a deliberate choice.
 */
export function AccountSyncPanel() {
  const account = useAccount();
  useEffect(() => { useAccount.getState().init(); }, []);
  useEffect(() => {
    if (account.phase === "signed-in") void useAccount.getState().refresh();
  }, [account.phase, account.user?.id]);

  return (
    <div className="account-center">
      <AccountHero user={account.user} status={account.protection} phase={account.phase} lastProtectedAt={account.lastProtectedAt} />

      {account.phase === "unconfigured" && <UnconfiguredCard />}
      {account.phase === "loading" && <div className="account-card account-loading" role="status">Checking your account…</div>}
      {account.phase === "signed-out" && <AuthCard />}
      {account.phase === "recovering-password" && <PasswordRecoveryCard />}
      {account.phase === "signed-in" && account.user && (
        <>
          <IdentityCard user={account.user} />
          <ProtectionCard />
          <VersionsCard history={account.history} />
          <DevicesCard devices={account.devices} />
          <DangerCard />
        </>
      )}

      {(account.message || account.error) && (
        <div className={`account-notice ${account.error ? "error" : ""}`} role={account.error ? "alert" : "status"}>
          {account.error ? <AlertTriangle size={ICON_SIZE.body} aria-hidden="true" /> : <Cloud size={ICON_SIZE.body} aria-hidden="true" />}
          <span>{account.error || account.message}</span>
        </div>
      )}

      <p className="account-footnote">You can always export, restore, or merge a portable copy in Emergency recovery.</p>
      <TechnicalDetails>
        {account.phase === "unconfigured" && (
          <p>This build has no cloud credentials configured, so sign-in and cloud copies are switched off. Local autosave and manual JSON recovery are unchanged.</p>
        )}
        <p>
          Portable JSON export, restore, and merge work with or without an account. Question attachment images stay on this device
          unless you include them in a portable backup; account protection covers workspace data, not binary attachment sync.
        </p>
      </TechnicalDetails>
    </div>
  );
}

function AccountHero({ user, status, phase, lastProtectedAt }: {
  user: AccountUser | null;
  status: ProtectionStatus;
  phase: string;
  lastProtectedAt?: string;
}) {
  const localName = useStore((state) => state.profile.name);
  const initial = (user?.displayName || user?.email || localName || "A").trim().charAt(0).toUpperCase();
  return (
    <div className="account-hero-card">
      <div className="account-hero-avatar" aria-hidden="true">{initial}</div>
      <div className="account-hero-copy">
        <h3>{user ? `Signed in as ${user.displayName}` : "Your work stays on this device. An account adds protection."}</h3>
        <p>
          {user
            ? status === "protected" && lastProtectedAt
              ? `Last protected ${relativeTime(lastProtectedAt)}. Changes back up in the background.`
              : user.email
            : "Saving on this device is always on. Signing in adds cloud copies you can restore, and lets you pick up on another device."}
        </p>
      </div>
      <Tag tone={STATUS_TONE[status]}>{phase === "unconfigured" ? "Local only" : protectionLabel(status)}</Tag>
    </div>
  );
}

function UnconfiguredCard() {
  return (
    <section className="account-card">
      <div className="account-card-head">
        <CloudOff size={ICON_SIZE.emphasis} aria-hidden="true" />
        <div>
          <h4>Accounts aren’t available in this version</h4>
          <p>Everything still saves on this device automatically, and you can export a copy anytime in Emergency recovery.</p>
        </div>
      </div>
      <ul className="account-benefits">
        <li><ShieldCheck size={ICON_SIZE.body} aria-hidden="true" /> Versioned cloud copies of your whole workspace</li>
        <li><Laptop size={ICON_SIZE.body} aria-hidden="true" /> Pick up on another device, on the web or the desktop app</li>
        <li><History size={ICON_SIZE.body} aria-hidden="true" /> Restore any of your last 60 protected versions</li>
      </ul>
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
    else if (mode === "create") await signUp(email, password, displayName);
    else if (mode === "forgot") await requestPasswordReset(email);
    else await sendCode(email);
  }

  return (
    <section className="account-card">
      <div className="account-auth-tabs" role="tablist" aria-label="How to sign in">
        {([
          ["sign-in", "Sign in", KeyRound],
          ["create", "Create account", UserPlus],
          ["code", "Email me a code", Mail],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id || (mode === "forgot" && id === "sign-in")} className={mode === id || (mode === "forgot" && id === "sign-in") ? "on" : ""} onClick={() => choose(id)}>
            <Icon size={ICON_SIZE.body} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <form className="account-form" onSubmit={(event) => void submit(event)}>
        {mode === "create" && (
          <label>
            <span>Name on your account</span>
            <input className="field" value={displayName} maxLength={80} autoComplete="name" onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        )}
        {!pendingCodeEmail && (
          <label>
            <span>Email</span>
            <input className="field" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
        )}
        {!pendingCodeEmail && (mode === "sign-in" || mode === "create") && (
          <label>
            <span>Password</span>
            <input
              className="field"
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
            <input className="field account-code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
        )}
        <div className="account-form-actions">
          <GButton variant="primary" type="submit" disabled={busy}>
            {pendingCodeEmail ? "Verify code" : mode === "sign-in" ? "Sign in" : mode === "create" ? "Create account" : mode === "forgot" ? "Send reset code" : "Send code"}
          </GButton>
          {!pendingCodeEmail && mode === "sign-in" && <button type="button" className="account-link" onClick={() => choose("forgot")}>Forgot password?</button>}
          {!pendingCodeEmail && mode === "forgot" && <button type="button" className="account-link" onClick={() => choose("sign-in")}>Back to sign in</button>}
          {pendingCodeEmail && <button type="button" className="account-link" onClick={() => choose(mode === "forgot" ? "sign-in" : mode)}>Use a different email</button>}
        </div>
        <p className="account-form-note">
          An account is optional. Signing in never uploads or replaces this device’s work until you choose to protect it.
          {(mode === "code" || pendingCodeEmail) && " Codes work in the browser and the desktop app."}
        </p>
      </form>
    </section>
  );
}

function PasswordRecoveryCard() {
  const { busy, updatePassword } = useAccount();
  const [password, setPassword] = useState("");
  return (
    <section className="account-card">
      <div className="account-card-head">
        <KeyRound size={ICON_SIZE.emphasis} aria-hidden="true" />
        <div><h4>Set a new password</h4><p>You opened a password-reset link. Choose a new password to finish.</p></div>
      </div>
      <form className="account-form" onSubmit={(event) => { event.preventDefault(); void updatePassword(password); }}>
        <label>
          <span>New password</span>
          <input className="field" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} />
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
    <section className="account-card account-identity">
      <div className="account-identity-main">
        {editing ? (
          <form className="account-inline-form" onSubmit={(event) => { event.preventDefault(); void updateDisplayName(name).then((ok) => ok && setEditing(false)); }}>
            <input className="field" aria-label="Account name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus />
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

function ProtectionCard() {
  const { link, protection, lastProtectedAt, conflictServerRevision, busy, linkThisDevice, syncNow, keepThisDevice, adoptAccountVersion, mergeWithAccount, signOut } = useAccount();
  if (link === "linked-elsewhere") {
    return (
      <section className="account-card account-warning">
        <div className="account-card-head">
          <AlertTriangle size={ICON_SIZE.emphasis} aria-hidden="true" />
          <div>
            <h4>This device belongs to a different account</h4>
            <p>The workspace here was protected by another AXOM account. To avoid mixing two people’s work, sign out — or protect it with this account (both accounts keep their own copies).</p>
          </div>
        </div>
        <div className="account-form-actions">
          <GButton size="sm" onClick={() => void signOut()}>Sign out</GButton>
          <GButton size="sm" onClick={() => void linkThisDevice()} disabled={busy}>Protect with this account</GButton>
        </div>
      </section>
    );
  }
  if (link === "unlinked") {
    return (
      <section className="account-card account-cta">
        <div className="account-card-head">
          <ShieldCheck size={ICON_SIZE.emphasis} aria-hidden="true" />
          <div>
            <h4>Protect this device’s workspace</h4>
            <p>Uploads a versioned copy now, then backs up changes in the background. If your account already has work from another device, both are kept and you choose which continues.</p>
          </div>
        </div>
        <div className="account-form-actions">
          <GButton variant="primary" onClick={() => void linkThisDevice()} disabled={busy}><ShieldCheck size={ICON_SIZE.body} aria-hidden="true" /> Protect this workspace</GButton>
        </div>
      </section>
    );
  }
  if (protection === "conflict") {
    return (
      <section className="account-card account-warning">
        <div className="account-card-head">
          <AlertTriangle size={ICON_SIZE.emphasis} aria-hidden="true" />
          <div>
            <h4>Two versions need a decision</h4>
            <p>
              Your account moved ahead on another device{conflictServerRevision ? ` (version #${conflictServerRevision})` : ""} while this device had changes.
              Both are safely stored. Choose which one continues — the other stays in history.
            </p>
          </div>
        </div>
        <div className="account-choice-grid three">
          <button type="button" className="account-choice recommended" onClick={() => void mergeWithAccount()} disabled={busy}>
            <GitMerge size={ICON_SIZE.emphasis} aria-hidden="true" />
            <b>Merge both <Tag tone="green">Recommended</Tag></b>
            <small>Combine records from both versions — newer copies win, nothing is deleted. Items deleted on one device may reappear.</small>
          </button>
          <button type="button" className="account-choice" onClick={() => void keepThisDevice()} disabled={busy}>
            <Laptop size={ICON_SIZE.emphasis} aria-hidden="true" />
            <b>Keep this device</b>
            <small>Upload this device’s workspace as the newest version.</small>
          </button>
          <button type="button" className="account-choice" onClick={() => void adoptAccountVersion()} disabled={busy}>
            <Download size={ICON_SIZE.emphasis} aria-hidden="true" />
            <b>Use the account version</b>
            <small>Replace this device with the newest protected version (a safety snapshot is made first).</small>
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="account-card account-protection">
      <div className="account-protection-status">
        <span className={`account-status-dot ${protection}`} aria-hidden="true" />
        <div>
          <b>{protectionLabel(protection)}</b>
          <small>{lastProtectedAt ? `Last protected ${relativeTime(lastProtectedAt)} · ${new Date(lastProtectedAt).toLocaleString()}` : "Waiting for the first upload"}</small>
        </div>
      </div>
      <GButton size="sm" onClick={() => void syncNow()} disabled={busy || protection === "syncing"}>
        <RefreshCw size={ICON_SIZE.body} aria-hidden="true" className={protection === "syncing" ? "spin" : ""} /> Protect now
      </GButton>
    </section>
  );
}

function VersionsCard({ history }: { history: RevisionSummary[] }) {
  const { busy, refresh, restoreRevision, link } = useAccount();
  if (link !== "linked" && !history.length) return null;
  return (
    <section className="account-card">
      <div className="account-section-head">
        <div><h4>Protected versions</h4><p>Newest first. Restoring saves a safety snapshot of this device first.</p></div>
        <GButton size="sm" onClick={() => void refresh()} disabled={busy}><RefreshCw size={ICON_SIZE.body} aria-hidden="true" /> Refresh</GButton>
      </div>
      {history.length === 0 ? (
        <p className="account-empty">No protected versions yet.</p>
      ) : (
        <ol className="account-version-list">
          {history.slice(0, 12).map((item, index) => (
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
    </section>
  );
}

function DevicesCard({ devices }: { devices: AccountDevice[] }) {
  const { busy, forgetDevice } = useAccount();
  if (!devices.length) return null;
  return (
    <section className="account-card">
      <div className="account-section-head"><div><h4>Devices</h4><p>Where this account has been used recently.</p></div></div>
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
    </section>
  );
}

function DangerCard() {
  const { busy, deleteCloudData, link } = useAccount();
  if (link !== "linked") return null;
  return (
    <details className="account-card account-danger">
      <summary>Delete cloud copies</summary>
      <p>Removes every protected version, shared question set, and device record from the server. This device’s workspace is not touched, and you can protect it again later.</p>
      <GButton size="sm" variant="danger" disabled={busy} onClick={() => {
        if (confirm("Delete every server copy of your AXOM workspace? Local data on this device stays. This cannot be undone.")) void deleteCloudData();
      }}><Trash2 size={ICON_SIZE.body} aria-hidden="true" /> Delete cloud copies</GButton>
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
