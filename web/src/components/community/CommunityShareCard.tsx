import { useState } from "react";
import { Globe, LockKeyhole, RefreshCw, Users } from "lucide-react";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";
import type { ShareMode } from "../../lib/community/progressBoard";
import { setCommunityShareMode, shareModeFor, useCommunityShare } from "../../lib/community/shareStore";
import { refreshCommunityShareMode } from "./CommunityProgressSync";

const OPTIONS: Array<{ id: ShareMode; label: string; detail: string; Icon: typeof Users }> = [
  { id: "off", label: "Off", detail: "Only days I post", Icon: LockKeyhole },
  { id: "friends", label: "Friends", detail: "Accepted friends", Icon: Users },
  { id: "community", label: "Community", detail: "Everyone in Community", Icon: Globe },
];

function sharedAgo(iso?: string) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The one switch behind automatic sharing: daily totals only, never the workspace. */
export function CommunityShareCard({ accountId, discoverable }: { accountId: string; discoverable: boolean }) {
  const mode = useCommunityShare(state => shareModeFor(state, accountId));
  const status = useCommunityShare(state => state.accountId === accountId ? state.status : "idle");
  const statusMessage = useCommunityShare(state => state.accountId === accountId ? state.message : "");
  const lastSharedAt = useCommunityShare(state => state.accountId === accountId ? state.lastSharedAt : undefined);
  const [saving, setSaving] = useState<ShareMode | null>(null);
  const [error, setError] = useState("");

  async function choose(next: ShareMode) {
    if (saving || next === mode) return;
    setSaving(next);
    setError("");
    try {
      const { saveShareMode } = await import("../../lib/community/community");
      await saveShareMode(accountId, next);
      setCommunityShareMode(accountId, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your sharing choice could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  return <GlassCard pad className="community-share">
    <PanelHeader headingLevel={2} title="Share my daily progress"
      sub="AXOM keeps today's study totals current for the people you choose, so they can cheer you on and you appear on their leaderboard." />
    <div className="community-share-options" role="group" aria-label="Automatic sharing">
      {OPTIONS.map(({ id, label, detail, Icon }) => <button key={id} type="button" aria-pressed={mode === id} className={mode === id ? "on" : ""}
        disabled={Boolean(saving) || mode === null} onClick={() => void choose(id)}>
        <Icon size={16} aria-hidden="true" /><b>{saving === id ? "Saving…" : label}</b><small>{detail}</small>
      </button>)}
    </div>
    <p className="sub">Shares only minutes studied, logged cards and questions answered for each day. Never your journal, notes, answers or sources. A day you post as "Only me" stays private.</p>
    {mode === "community" && !discoverable && <p className="community-share-note">Community-wide totals appear only while your profile is discoverable. Friends still see them.</p>}
    <div className="community-share-status" aria-live="polite">
      {mode === null && status !== "error" && <span>Checking your sharing choice…</span>}
      {mode === "off" && <span>Your daily totals stay private unless you post them.</span>}
      {(mode === "friends" || mode === "community") && status === "sharing" && <span>Sharing today's totals…</span>}
      {(mode === "friends" || mode === "community") && status === "shared" && <span>Today's totals are shared{lastSharedAt ? ` · updated ${sharedAgo(lastSharedAt)}` : ""}.</span>}
      {(mode === "friends" || mode === "community") && status === "idle" && <span>Your totals update a few seconds after you log study.</span>}
    </div>
    {(status === "error" || status === "needs-profile") && statusMessage && <div role="alert" className="community-error"><p>{statusMessage}</p>
      {mode === null && <GButton size="sm" onClick={() => void refreshCommunityShareMode(accountId)}><RefreshCw size={14} aria-hidden="true" /> Retry</GButton>}</div>}
    {error && <p role="alert" className="community-error">{error}</p>}
  </GlassCard>;
}
