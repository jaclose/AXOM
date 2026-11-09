import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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

export function CommunityPersonButton({ profile, name, onClick, avatar = true, className = "" }: {
  profile?: Pick<CommunityProfile, "display_name" | "handle"> & Partial<Pick<CommunityProfile, "bio">>;
  name?: string; onClick: () => void; avatar?: boolean; className?: string;
}) {
  const label = name || profile?.display_name || "Learner";
  const profileLabel = profile?.display_name || label;
  const previewId = useId();
  const [preview, setPreview] = useState(false);
  const [previewStyle, setPreviewStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!preview) return;
    const placePreview = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const tip = previewRef.current?.getBoundingClientRect();
      if (!anchor || !tip) return;
      const below = anchor.bottom + 8;
      setPreviewStyle({
        left: Math.max(12, Math.min(anchor.left, window.innerWidth - tip.width - 12)),
        top: Math.max(12, below + tip.height > window.innerHeight - 12 ? anchor.top - tip.height - 8 : below),
      });
    };
    placePreview();
    window.addEventListener("resize", placePreview);
    window.addEventListener("scroll", placePreview, true);
    return () => {
      window.removeEventListener("resize", placePreview);
      window.removeEventListener("scroll", placePreview, true);
    };
  }, [preview]);
  return <button ref={buttonRef} type="button" className={`community-person-link ${className}`} onClick={() => { setPreview(false); onClick(); }} aria-label={`View ${profileLabel}'s profile`}
    aria-describedby={preview ? previewId : undefined}
    onMouseEnter={() => setPreview(true)} onMouseLeave={() => setPreview(false)}
    onFocus={() => setPreview(true)} onBlur={() => setPreview(false)} onKeyDown={event => { if (event.key === "Escape") setPreview(false); }}>
    {avatar && <CommunityAvatar name={label} />}
    <span className="community-person-label"><strong>{label}</strong>{profile && <small>@{profile.handle}</small>}</span>
    {preview && createPortal(<span ref={previewRef} id={previewId} role="tooltip" className="community-profile-preview" style={previewStyle}>
      <strong>{profileLabel}</strong>{profile && <small>@{profile.handle}</small>}
      {profile?.bio && <span>{profile.bio}</span>}<small>Open profile to see shared activity</small>
    </span>, document.body)}
  </button>;
}

/** Identity is edited in Community; all account sharing preferences stay in Settings. */
export function CommunityIdentityDialog({ accountId, profile, displayName, onClose, onSaved }: {
  accountId: string; profile?: CommunityProfile; displayName?: string; onClose: () => void; onSaved: (message: string) => void;
}) {
  const bioId = useId();
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
      <div className="community-textarea-field"><label htmlFor={bioId}>Biography</label>
        <textarea id={bioId} name="bio" value={bio} maxLength={240} rows={3} disabled={saving}
          placeholder="What are you learning? What would you like to study together?" onChange={event => setBio(event.target.value)} /></div>
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
