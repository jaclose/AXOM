import { useEffect, useState } from "react";
import { Compass, ShieldCheck } from "lucide-react";
import { GlassCard, GButton } from "../ui/primitives";
import { AXOM_CORRESPONDENTS, type CorrespondentId } from "../../lib/communications/correspondents";
import {
  confirmAtlasCompanion, disableAtlasCompanion, dismissPassiveAtlas,
  readConfirmedAtlasCompanion, readPassiveAtlasProposal, readPassiveAtlasSession,
} from "../../lib/communications/passiveFirstRunClient";
import type { PassiveProposal } from "../../lib/communications/passiveFirstRun";

/**
 * A calm review gate after an explicitly consented first-run observation.
 * The learner owns the choice; no academic grading, account metadata or
 * dashboard configuration is silently rewritten.
 */
export function AtlasFirstRunCard() {
  const [preview, setPreview] = useState<PassiveProposal>(() => readPassiveAtlasProposal());
  const [confirmed, setConfirmed] = useState<CorrespondentId | null>(() => readConfirmedAtlasCompanion());
  const [hasSession, setHasSession] = useState(() => Boolean(readPassiveAtlasSession()));
  const [choice, setChoice] = useState<CorrespondentId | "">("");
  const [showDetails, setShowDetails] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      setPreview(readPassiveAtlasProposal());
      setHasSession(Boolean(readPassiveAtlasSession()));
      setConfirmed(readConfirmedAtlasCompanion());
    };
    const id = window.setInterval(check, 12000);
    return () => window.clearInterval(id);
  }, []);

  if (!hasSession && !confirmed) return null;
  const confirmedCard = AXOM_CORRESPONDENTS.find(c => c.id === confirmed);
  if (confirmedCard) {
    return <GlassCard className="atlas-first-run" aria-label="Your Atlas companion">
      <div className="row wrap gap12" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span className="eyebrow">THE LIVING ATLAS / YOUR CHOICE</span>
          <h2 style={{ margin: "8px 0 6px", fontSize: 22 }}>{confirmedCard.name}</h2>
          <p style={{ color: "var(--text-60)", margin: 0 }}>{confirmedCard.description}</p>
          <p style={{ color: "var(--text-50)", fontSize: 12, marginTop: 6 }}>Saved on this device. Account synchronization is not yet enabled.</p>
        </div>
        <GButton size="sm" onClick={() => { disableAtlasCompanion(); setConfirmed(null); setHasSession(false); }}>
          Turn off companion
        </GButton>
      </div>
    </GlassCard>;
  }
  if (preview.status === "off" || preview.status === "observing") return null;
  const suggestedId = preview.suggestion?.id;
  const selectedId = choice || suggestedId || "";
  const chosenCard = AXOM_CORRESPONDENTS.find(c => c.id === selectedId);
  const canChoose = Boolean(chosenCard);

  return <GlassCard className="atlas-first-run" aria-label="Review your provisional Atlas companion">
    <div className="row gap12" style={{ alignItems: "center" }}>
      <Compass size={24} color="var(--gold)" aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        <span className="eyebrow">LIVING ATLAS / OPTIONAL FIRST-RUN GUIDE</span>
        <h2 style={{ fontSize: 23, margin: "6px 0 8px" }}>
          {preview.status === "ready" ? "A companion is taking shape." : "Make the Atlas your own."}
        </h2>
      </div>
    </div>
    <p style={{ color: "var(--text-70)", lineHeight: 1.65 }}>
      {preview.status === "ready"
        ? "Your early study choices and a few deliberate actions suggest a provisional learning-interface fit. This is not a personality diagnosis, and you decide whether to keep the character."
        : "AXOM has not observed enough meaningful choices to suggest a companion responsibly. You can choose one yourself or continue without one."}
    </p>
    {preview.suggestion && !showAll && <div style={{ borderLeft: "2px solid var(--gold)", paddingLeft: 14, margin: "16px 0" }}>
      <strong style={{ fontSize: 20 }}>{preview.suggestion.name}</strong>
      <p style={{ color: "var(--text-70)", margin: "8px 0" }}>{preview.suggestion.description}</p>
      <button type="button" className="account-link" onClick={() => setShowDetails(x => !x)} aria-expanded={showDetails}>
        {showDetails ? "Hide evidence" : "Why this is a tentative fit"}
      </button>
      {showDetails && <ul style={{ fontSize: 13, lineHeight: 1.6 }}>
        {preview.explanation.map(reason => <li key={reason}>{reason}</li>)}
      </ul>}
    </div>}
    {showAll && <label style={{ display: "block", margin: "14px 0" }}>
      <span style={{ display: "block", color: "var(--text-60)", marginBottom: 8 }}>Choose any of the 25 companions</span>
      <select className="field" aria-label="Choose Atlas companion" value={selectedId}
        onChange={event => setChoice(event.target.value as CorrespondentId)}>
        <option value="">Choose a companion</option>
        {AXOM_CORRESPONDENTS.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
      </select>
    </label>}
    {preview.status === "ready" && <p style={{ color: "var(--text-50)", fontSize: 12 }}>
      Suggested dashboard priority: {preview.proposedConfig.dashboardPriority.replaceAll("-", " ")}. This is a preview only; no layout or study data has been changed.
    </p>}
    <div className="row wrap gap8" style={{ marginTop: 18 }}>
      <GButton variant="primary" disabled={!canChoose}
        onClick={() => { if (chosenCard && confirmAtlasCompanion(chosenCard.id)) { setConfirmed(chosenCard.id); setHasSession(false); } }}>
        {preview.status === "ready" ? "Keep this companion" : "Use selected companion"}
      </GButton>
      <GButton onClick={() => setShowAll(x => !x)}>{showAll ? "Close choices" : "Choose a different one"}</GButton>
      <GButton onClick={() => { dismissPassiveAtlas(); setHasSession(false); }}>Not now</GButton>
    </div>
    <div className="row gap8" style={{ alignItems: "center", color: "var(--text-50)", fontSize: 12, marginTop: 16 }}>
      <ShieldCheck size={14} aria-hidden="true" />
      <span>No journal text or raw click history was collected. No email, marketing or account setting is enabled by this suggestion.</span>
    </div>
  </GlassCard>;
}
