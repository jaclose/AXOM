import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import { useAccount, type CommunitySignupPreferences } from "../../lib/account/accountStore";
import { setCommunityShareMode, useCommunityShare } from "../../lib/community/shareStore";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import { CommunityShareCard } from "./CommunityShareCard";
import "../../styles/community-preferences.css";

const PRIVATE_CHOICES: CommunitySignupPreferences = { discoverable: false, shareMode: "off" };

/** Discovery and automatic sharing are separate opt-ins, reused by every creation flow. */
export function CommunityPreferenceFields({ value, onChange, disabled = false }: {
  value: CommunitySignupPreferences;
  onChange: (value: CommunitySignupPreferences) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="community-preference-fields">
      <label className="community-discovery-choice">
        <input type="checkbox" checked={value.discoverable} disabled={disabled}
          aria-labelledby={`${id}-discovery-label`} aria-describedby={`${id}-discovery-help`} onChange={event => onChange({ ...value, discoverable: event.target.checked })} />
        <span><strong id={`${id}-discovery-label`}>Appear in learner search</strong><small id={`${id}-discovery-help`}>Let other learners find your Community profile. Accepted friends can still see you when this is off.</small></span>
      </label>
      <CommunityShareCard mode={value.shareMode} discoverable={value.discoverable} disabled={disabled}
        onChange={shareMode => onChange({ ...value, shareMode })} />
    </div>
  );
}

/** Key the whole editor by account so a response or draft never follows a user switch. */
export function CommunityPreferencesSettings({ accountId, onOpenCommunity, onReviewWorkspace }: {
  accountId: string;
  onOpenCommunity?: () => void;
  onReviewWorkspace?: () => void;
}) {
  return <AccountCommunityPreferences key={accountId} accountId={accountId} onOpenCommunity={onOpenCommunity} onReviewWorkspace={onReviewWorkspace} />;
}

function AccountCommunityPreferences({ accountId, onOpenCommunity, onReviewWorkspace }: {
  accountId: string;
  onOpenCommunity?: () => void;
  onReviewWorkspace?: () => void;
}) {
  const [saved, setSaved] = useState<CommunitySignupPreferences | null>(null);
  const [draft, setDraft] = useState<CommunitySignupPreferences>(PRIVATE_CHOICES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "leave" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const request = useRef(0);
  const active = useRef(true);
  const sharing = useCommunityShare();
  const isCurrent = (operation: number) => active.current && request.current === operation && useAccount.getState().user?.id === accountId;

  useEffect(() => {
    active.current = true;
    const operation = ++request.current;
    setLoading(true);
    setError("");
    void import("../../lib/community/community").then(({ readCommunityPreferences }) => {
      if (!active.current || request.current !== operation || useAccount.getState().user?.id !== accountId) return null;
      return readCommunityPreferences(accountId);
    })
      .then(preferences => {
        if (!preferences || !active.current || request.current !== operation || useAccount.getState().user?.id !== accountId) return;
        setSaved(preferences);
        setDraft(preferences);
        setCommunityShareMode(accountId, preferences.shareMode, preferences.revision);
      })
      .catch(cause => {
        if (!active.current || request.current !== operation || useAccount.getState().user?.id !== accountId) return;
        setError(cause instanceof Error ? cause.message : "Your Community choices could not be loaded. Try again.");
      })
      .finally(() => {
        if (active.current && request.current === operation && useAccount.getState().user?.id === accountId) setLoading(false);
      });
    return () => { active.current = false; };
  }, [accountId, reload]);

  const changed = saved !== null && (draft.discoverable !== saved.discoverable || draft.shareMode !== saved.shareMode);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!saved || loading || busy || retrying || !changed || useAccount.getState().user?.id !== accountId) return;
    const operation = ++request.current;
    const choices = { discoverable: draft.discoverable, shareMode: draft.shareMode };
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const { saveCommunityPreferences } = await import("../../lib/community/community");
      if (!isCurrent(operation)) return;
      const preferences = await saveCommunityPreferences(accountId, choices);
      if (!isCurrent(operation)) return;
      setSaved(preferences);
      setDraft(preferences);
      setCommunityShareMode(accountId, preferences.shareMode, preferences.revision);
      window.dispatchEvent(new Event("axom:community-changed"));
      setMessage("Community choices saved for your account.");
    } catch (cause) {
      if (isCurrent(operation)) setError(cause instanceof Error ? cause.message : "Your Community choices could not be saved. Try again.");
    } finally {
      if (isCurrent(operation)) setBusy(null);
    }
  }

  async function leave() {
    if (loading || busy || retrying || !saved || useAccount.getState().user?.id !== accountId) return;
    if (!window.confirm("Leave Community? This removes your Community profile, posts, reactions and friend connections, and turns off discovery and automatic sharing. Your private workspace and account stay intact.")) return;
    const operation = ++request.current;
    setBusy("leave");
    setError("");
    setMessage("");
    try {
      const { leaveCommunity } = await import("../../lib/community/community");
      if (!isCurrent(operation)) return;
      await leaveCommunity(accountId);
      if (!isCurrent(operation)) return;
      setSaved(PRIVATE_CHOICES);
      setDraft(PRIVATE_CHOICES);
      setCommunityShareMode(accountId, "off");
      window.dispatchEvent(new Event("axom:community-changed"));
      setMessage("You left Community. Your private workspace and account are unchanged.");
    } catch (cause) {
      if (isCurrent(operation)) setError(cause instanceof Error ? cause.message : "You could not leave Community. Try again.");
    } finally {
      if (isCurrent(operation)) setBusy(null);
    }
  }

  async function retrySharing() {
    if (retrying || loading || busy || changed || useAccount.getState().user?.id !== accountId) return;
    const operation = request.current;
    setRetrying(true);
    try {
      const { retryCommunityProgress } = await import("./CommunityProgressSync");
      if (!isCurrent(operation)) return;
      await retryCommunityProgress(accountId);
      if (isCurrent(operation)) setReload(value => value + 1);
    } catch (cause) {
      if (isCurrent(operation)) setError(cause instanceof Error ? cause.message : "Your sharing choice could not be checked. Try again.");
    } finally {
      if (isCurrent(operation)) setRetrying(false);
    }
  }

  const syncStatus = sharing.accountId === accountId ? sharing.status : "idle";
  const syncMessage = sharing.accountId === accountId ? sharing.message : "";

  return (
    <GlassCard className="community-preferences" role="region" aria-label="Community and leaderboards" aria-busy={loading || Boolean(busy) || retrying}>
      <PanelHeader headingLevel={2} title="Community & leaderboards"
        sub="Choose who can find your profile and whether your daily totals are shared." />
      {loading && <p className="community-preferences-help" role="status">Checking your Community choices…</p>}
      {!loading && !saved && <GButton size="sm" onClick={() => setReload(value => value + 1)}><RefreshCw size={ICON_SIZE.body} aria-hidden="true" /> Retry Community choices</GButton>}
      {saved && (
        <form className="community-preferences-form" onSubmit={event => void save(event)}>
          <CommunityPreferenceFields value={draft} disabled={loading || Boolean(busy) || retrying} onChange={value => { setDraft(value); setMessage(""); }} />
          <p className="community-preferences-help"><ShieldCheck size={ICON_SIZE.body} aria-hidden="true" /> Off makes automatic progress posts private. Friends limits them to accepted friends. Posts you publish yourself keep their own audience until you change or delete them in Community.</p>
          <div className="community-preferences-actions">
            <GButton type="submit" size="sm" variant="primary" disabled={loading || Boolean(busy) || retrying || !changed}>{busy === "save" ? "Saving…" : "Save Community choices"}</GButton>
            {changed && <GButton type="button" size="sm" disabled={Boolean(busy) || retrying} onClick={() => { setDraft(saved); setError(""); setMessage(""); }}>Cancel changes</GButton>}
          </div>
        </form>
      )}
      {error && <p className="community-preferences-error" role="alert">{error}</p>}
      {message && <p className="community-preferences-result" role="status">{message}</p>}
      {saved?.shareMode !== "off" && saved && (
        <div className="community-preferences-sync" aria-live="polite">
          {syncStatus === "sharing" && <p>Sharing today’s totals…</p>}
          {syncStatus === "shared" && <p>Today’s totals are shared.</p>}
          {syncStatus === "needs-profile" && <p>Choose a handle in Community before your daily totals can be shared.</p>}
          {syncStatus === "needs-device" && <><p>Review device protection above before this workspace’s study totals can be shared automatically.</p>
            {onReviewWorkspace && <GButton type="button" size="sm" onClick={onReviewWorkspace}>Review device protection</GButton>}</>}
          {syncStatus === "error" && <><p role="alert">{syncMessage || "Your daily totals could not be shared. Try again."}</p>
            <GButton type="button" size="sm" disabled={retrying || loading || Boolean(busy) || changed} onClick={() => void retrySharing()}><RefreshCw size={ICON_SIZE.body} aria-hidden="true" /> {retrying ? "Retrying…" : "Retry progress sharing"}</GButton></>}
        </div>
      )}
      <div className="community-preferences-profile-link">
        <p>Choose a handle, edit your profile and manage individual posts in Community.</p>
        <a href="#communities" onClick={onOpenCommunity}>Open Community <ArrowUpRight size={ICON_SIZE.body} aria-hidden="true" /></a>
      </div>
      {saved && <details className="community-preferences-leave">
        <summary>Leave Community</summary>
        <p>Remove your Community profile, posts and friendships. Your private workspace and account stay intact.</p>
        <GButton variant="danger" size="sm" disabled={loading || Boolean(busy) || retrying} onClick={() => void leave()}>{busy === "leave" ? "Leaving…" : "Leave Community"}</GButton>
      </details>}
    </GlassCard>
  );
}
