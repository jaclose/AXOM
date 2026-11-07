import { useEffect, useState } from "react";
import { Compass, ShieldCheck } from "lucide-react";
import { GButton } from "../ui/primitives";
import { useAccount } from "../../lib/account/accountStore";
import { AXOM_CORRESPONDENTS, type CorrespondentId } from "../../lib/communications/correspondents";
import { atlasStudyLens } from "../../lib/communications/atlasRecommendations";
import {
  ATLAS_COMPANION_CHANGED_EVENT, confirmAtlasCompanion,
  disableAtlasCompanion, dismissPassiveAtlas, readConfirmedAtlasCompanion,
  readPassiveAtlasSession,
} from "../../lib/communications/passiveFirstRunClient";

/** Separate, user-controlled settings UI. Never infers a medical or psychological identity. */
export function AtlasPreferencesSettings() {
  const accountId = useAccount(state => state.user?.id) ?? null;
  const [saved, setSaved] = useState<CorrespondentId | null>(() => readConfirmedAtlasCompanion(accountId));
  const [draft, setDraft] = useState<CorrespondentId | "">(() => readConfirmedAtlasCompanion(accountId) ?? "");
  const [observing, setObserving] = useState(() => Boolean(readPassiveAtlasSession()));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const refresh = () => {
      const choice = readConfirmedAtlasCompanion(accountId);
      setSaved(choice);
      setDraft(choice ?? "");
      setObserving(Boolean(readPassiveAtlasSession()));
    };
    refresh();
    window.addEventListener(ATLAS_COMPANION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ATLAS_COMPANION_CHANGED_EVENT, refresh);
  }, [accountId]);

  const character = AXOM_CORRESPONDENTS.find(c => c.id === saved);
  const lens = character ? atlasStudyLens(character.id) : null;

  function save() {
    if (!draft) return;
    if (confirmAtlasCompanion(draft, Date.now(), accountId)) {
      setSaved(draft);
      setObserving(false);
      setNotice(draft.charAt(0).toUpperCase() + draft.slice(1) + " saved on this device. You can change it at any time.");
    } else {
      setNotice("The companion could not be saved on this device.");
    }
  }
  function disable() {
    disableAtlasCompanion(accountId);
    setDraft("");
    setSaved(null);
    setObserving(false);
    setNotice("Atlas companion turned off. Your existing dashboard and academic work are unchanged.");
  }

  return <section className="backup-actions-panel atlas-settings" aria-label="Living Atlas companion settings">
    <div className="row gap12" style={{ alignItems: "center" }}>
      <Compass size={22} color="var(--gold)" aria-hidden="true" />
      <div>
        <span className="settings-eyebrow">PERSONALIZATION / LIVING ATLAS</span>
        <h3 style={{ margin: "6px 0" }}>A learning companion, your choice.</h3>
      </div>
    </div>
    <p style={{ color: "var(--text-70)", lineHeight: 1.65 }}>
      AXOM can suggest one of 25 fictional academic guides from preferences you chose to share.
      This is not a personality diagnosis. Selecting a character does not alter grades, question answers,
      privacy permissions, or email subscriptions.
    </p>
    <label style={{ display: "block", margin: "10px 0" }}>
      <span className="field-label">Choose your Atlas companion</span>
      <select className="field" aria-label="Choose your Atlas companion" value={draft}
        onChange={e => { setDraft(e.target.value as CorrespondentId | ""); setNotice(""); }}>
        <option value="">No companion selected</option>
        {AXOM_CORRESPONDENTS.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
      </select>
    </label>
    {character && lens && <div style={{ borderLeft: "2px solid var(--gold)", paddingLeft: 12, margin: "12px 0" }}>
      <strong>{character.name} is your companion.</strong>
      <p style={{ color: "var(--text-70)", lineHeight: 1.6 }}>{character.description}</p>
      <p style={{ color: "var(--text-60)", fontSize: 13 }}>
        Learning focus: {lens.title}. This offers a meaningful starting action without assessing your ability.
      </p>
    </div>}
    <div className="row wrap gap8" style={{ margin: "12px 0" }}>
      <GButton size="sm" variant="primary" disabled={!draft || draft === saved} onClick={save}>Save Atlas companion</GButton>
      {saved && <GButton size="sm" onClick={disable}>Turn off Atlas companion</GButton>}
      {observing && <GButton size="sm" onClick={() => {
        dismissPassiveAtlas();
        setObserving(false);
        setNotice("The temporary Atlas observation was discarded.");
      }}>Discard Atlas observation</GButton>}
    </div>
    {notice && <p role="status" style={{ color: "var(--text-70)", fontSize: 12 }}>{notice}</p>}
    <div className="row gap8" style={{ color: "var(--text-50)", alignItems: "start", marginTop: 12 }}>
      <ShieldCheck size={15} aria-hidden="true" />
      <small>
        The chosen companion stays on this device and is isolated by account.
        Observation aggregates stay within this browser tab and expire automatically.
        Cross-device identity sync and production companion email delivery are not active.
      </small>
    </div>
  </section>;
}
