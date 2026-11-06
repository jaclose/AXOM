import { useState } from "react";
import { AtSign, Check, Pencil, UserRound } from "lucide-react";
import { joinCommunity, updateCommunityProfile, type CommunityProfile } from "../../lib/community/community";
import { useUi } from "../../lib/uiStore";
import { GButton, GhostButton } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { retryCommunityProgress } from "./CommunityProgressSync";

export function communityInitials(label: string) {
  return label.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]?.toUpperCase() ?? "").join("") || "?";
}

export function CommunityAvatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`community-avatar${large ? " large" : ""}`} aria-hidden="true">{communityInitials(name)}</span>;
}

export function CommunityPersonButton({ profile, name, onClick }: {
  profile?: Pick<CommunityProfile, "display_name" | "handle">; name?: string; onClick: () => void;
}) {
  const label = profile?.display_name || name || "Learner";
  return <button type="button" className="community-person-link" onClick={onClick} aria-label={`View ${label}'s profile`}>
    <CommunityAvatar name={label} />
    <span><strong>{label}</strong>{profile && <small>@{profile.handle}</small>}</span>
  </button>;
}

/** Identity is edited in Community; all account sharing preferences stay in Settings. */
export function CommunityIdentityDialog({ accountId, profile, displayName, onClose, onSaved }: {
  accountId: string; profile?: CommunityProfile; displayName?: string; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [handle, setHandle] = useState(profile?.handle ?? (displayName ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30));
  const [name, setName] = useState(profile?.display_name ?? displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (saving) return;
    setSaving(true); setError("");
    try {
      if (profile) await updateCommunityProfile(accountId, { handle, displayName: name, bio });
      else {
        await joinCommunity(accountId, handle, name, bio);
        void retryCommunityProgress(accountId);
      }
      onSaved(profile ? "Your community profile is updated." : "Your community profile is ready.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your profile could not be saved. Your details are still here.");
    } finally { setSaving(false); }
  }

  return <Modal title={profile ? "Edit community profile" : "Create your community profile"}
    onClose={() => { if (!saving) onClose(); }} className="community-dialog" bodyClassName="community-dialog-body">
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="community-identity-preview"><CommunityAvatar name={name || "You"} large />
        <div><strong>{name.trim() || "Your name"}</strong><small>@{handle || "your_handle"}</small></div>
      </div>
      <p className="sub">Choose the name people see beside your posts. A nickname is welcome.</p>
      <div className="community-fields">
        <label><span><UserRound size={14} aria-hidden="true" /> Display name</span>
          <input name="display-name" value={name} maxLength={80} required autoComplete="nickname" disabled={saving}
            onChange={event => setName(event.target.value)} /></label>
        <label><span><AtSign size={14} aria-hidden="true" /> Public handle</span>
          <input name="handle" value={handle} minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_]{2,29}" required
            autoCapitalize="none" spellCheck={false} autoComplete="username" disabled={saving}
            onChange={event => setHandle(event.target.value.toLowerCase())} placeholder="your_handle" />
          <small>3–30 letters, numbers or underscores.</small></label>
      </div>
      <label>Biography <textarea name="bio" value={bio} maxLength={240} rows={3} disabled={saving}
        placeholder="What are you learning? What would you like to study together?" onChange={event => setBio(event.target.value)} /></label>
      <span className="community-character-count">{bio.length}/240</span>
      <p className="sub">Your sharing choices are managed in account settings. Editing this profile does not change them.</p>
      {error && <p role="alert" className="community-error">{error}</p>}
      <div className="community-form-actions">
        <GhostButton type="button" disabled={saving} onClick={onClose}>Cancel</GhostButton>
        <GButton type="submit" variant="primary" disabled={saving || !name.trim()}>
          {profile ? <Check size={16} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
          {saving ? "Saving…" : profile ? "Save profile" : "Create profile"}
        </GButton>
      </div>
    </form>
  </Modal>;
}

export function CommunitySettingsLink() {
  return <GhostButton onClick={() => useUi.getState().requestSettings("account")}>Account sharing settings</GhostButton>;
}
