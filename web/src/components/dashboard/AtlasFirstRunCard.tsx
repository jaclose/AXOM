import { useEffect, useState } from "react";
import { Compass, ShieldCheck } from "lucide-react";
import { GlassCard, GButton } from "../ui/primitives";
import { useStore } from "../../lib/store";
import { useUi } from "../../lib/uiStore";
import { useAccount } from "../../lib/account/accountStore";
import { normalizeDashboardLayoutPreferences } from "../../lib/dashboardWidgets";
import type { DashboardLayoutPreferences } from "../../lib/types";
import { AXOM_CORRESPONDENTS, type CorrespondentId } from "../../lib/communications/correspondents";
import { atlasStudyLens, planAtlasDashboardPriority, undoAtlasDashboardPriority } from "../../lib/communications/atlasRecommendations";
import {
  ATLAS_COMPANION_CHANGED_EVENT, confirmAtlasCompanion, disableAtlasCompanion,
  dismissPassiveAtlas, readConfirmedAtlasCompanion, readConfirmedAtlasPriority,
  readPassiveAtlasProposal, readPassiveAtlasSession,
} from "../../lib/communications/passiveFirstRunClient";
import type { PassiveProposal } from "../../lib/communications/passiveFirstRun";

type LayoutUndo = { previous: DashboardLayoutPreferences; applied: DashboardLayoutPreferences };

/**
 * A review gate, not a personality diagnosis. The learner can take an academic
 * action, separately approve a non-destructive dashboard reorder, or decline.
 * No email, answer key, grade or study metric is changed.
 */
export function AtlasFirstRunCard() {
  const accountId = useAccount(state => state.user?.id) ?? null;
  const currentDashboardLayout = useStore(state => state.profile.dashboardLayout);
  const updateProfile = useStore(state => state.updateProfile);
  const [preview, setPreview] = useState<PassiveProposal>(() => readPassiveAtlasProposal());
  const [confirmed, setConfirmed] = useState<CorrespondentId | null>(() => readConfirmedAtlasCompanion(accountId));
  const [hasSession, setHasSession] = useState(() => Boolean(readPassiveAtlasSession()));
  const [choice, setChoice] = useState<CorrespondentId | "">("");
  const [showDetails, setShowDetails] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [layoutUndo, setLayoutUndo] = useState<LayoutUndo | null>(null);
  const [layoutNotice, setLayoutNotice] = useState("");

  useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      setPreview(readPassiveAtlasProposal());
      setHasSession(Boolean(readPassiveAtlasSession()));
      setConfirmed(readConfirmedAtlasCompanion(accountId));
    };
    check();
    const timer = window.setInterval(check, 12000);
    window.addEventListener(ATLAS_COMPANION_CHANGED_EVENT, check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(ATLAS_COMPANION_CHANGED_EVENT, check);
    };
  }, [accountId]);

  useEffect(() => {
    setLayoutUndo(null);
    setLayoutNotice("");
  }, [accountId]);

  function applyDashboardSuggestion() {
    const priority = readConfirmedAtlasPriority(accountId);
    if (!priority) return;
    const existing = useStore.getState().profile.dashboardLayout;
    const previous = normalizeDashboardLayoutPreferences(existing);
    const plan = planAtlasDashboardPriority(existing, priority);
    if (!previous || plan.status !== "ready" || !plan.next) {
      setLayoutNotice(plan.description);
      return;
    }
    updateProfile({ dashboardLayout: plan.next });
    setLayoutUndo({ previous, applied: plan.next });
    setLayoutNotice("Dashboard updated. Only the widget order changed; you can undo it.");
  }

  function undoDashboardSuggestion() {
    if (!layoutUndo) return;
    const current = useStore.getState().profile.dashboardLayout;
    const safePrevious = undoAtlasDashboardPriority(current, layoutUndo.previous, layoutUndo.applied);
    if (!safePrevious) {
      setLayoutNotice("Newer dashboard changes were preserved. Your other edits were not overwritten.");
      setLayoutUndo(null);
      return;
    }
    updateProfile({ dashboardLayout: safePrevious });
    setLayoutUndo(null);
    setLayoutNotice("Original dashboard order restored.");
  }

  if (!hasSession && !confirmed) return null;
  const confirmedCard = AXOM_CORRESPONDENTS.find(c => c.id === confirmed);
  if (confirmedCard) {
    const lens = atlasStudyLens(confirmedCard.id);
    const priority = readConfirmedAtlasPriority(accountId);
    const layoutPlan = planAtlasDashboardPriority(currentDashboardLayout, priority ?? "keep-current");
    return <GlassCard className="atlas-first-run" aria-label="Your Atlas companion and academic guidance">
      <div className="row wrap gap12" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">THE LIVING ATLAS / YOUR CHOICE</span>
          <h2 style={{ margin: "8px 0 6px", fontSize: 22 }}>{confirmedCard.name}</h2>
          <p style={{ color: "var(--text-60)", margin: 0 }}>{confirmedCard.description}</p>
          <p style={{ color: "var(--text-50)", fontSize: 12, marginTop: 6 }}>Saved on this device for the current account. Cross-device synchronization is not yet enabled.</p>
        </div>
        <GButton size="sm" onClick={() => {
          disableAtlasCompanion(accountId); setConfirmed(null); setHasSession(false);
          setLayoutUndo(null);
        }}>Turn off companion</GButton>
      </div>
      <div style={{ margin: "18px 0 0", borderTop: "1px solid var(--hairline)", paddingTop: 15 }}>
        <span className="eyebrow">YOUR NEXT STUDY LENS</span>
        <h3 style={{ margin: "8px 0", fontSize: 18 }}>{lens.title}</h3>
        <p style={{ color: "var(--text-70)", lineHeight: 1.6 }}>{lens.rationale}</p>
        <a className="gbtn sm" href={"#" + lens.route}>{lens.actionLabel}</a>
      </div>
      {priority && <div style={{ marginTop: 18, borderTop: "1px solid var(--hairline)", paddingTop: 15 }}>
        <span className="eyebrow">OPTIONAL DASHBOARD ADAPTATION</span>
        <p style={{ color: "var(--text-70)", lineHeight: 1.6, margin: "8px 0 12px" }}>{layoutPlan.description}</p>
        <div className="row wrap gap8">
          {layoutPlan.status === "ready" && <GButton size="sm" onClick={applyDashboardSuggestion}>Apply dashboard suggestion</GButton>}
          {layoutUndo && <GButton size="sm" onClick={undoDashboardSuggestion}>Undo dashboard change</GButton>}
        </div>
      </div>}
      {layoutNotice && <p role="status" style={{ color: "var(--text-70)", fontSize: 12, marginTop: 12 }}>{layoutNotice}</p>}
      <div style={{ marginTop: 16 }}>
        <button className="account-link" type="button" onClick={() => useUi.getState().requestSettings("atlas")}>Change companion in Settings</button>
      </div>
    </GlassCard>;
  }

  if (preview.status === "off" || preview.status === "observing") return null;
  const suggestedId = preview.suggestion?.id;
  const selectedId = choice || suggestedId || "";
  const chosenCard = AXOM_CORRESPONDENTS.find(c => c.id === selectedId);

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
        ? "Your early study choices and a few deliberate actions suggest a provisional interface preference. This is not a personality diagnosis, and you decide whether to keep the character."
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
      Proposed dashboard priority: {preview.proposedConfig.dashboardPriority.replaceAll("-", " ")}. No layout or academic data has been changed.
    </p>}
    <div className="row wrap gap8" style={{ marginTop: 18 }}>
      <GButton variant="primary" disabled={!chosenCard}
        onClick={() => {
          if (chosenCard && confirmAtlasCompanion(chosenCard.id, Date.now(), accountId,
            preview.status === "ready" ? preview.proposedConfig.dashboardPriority : undefined)) {
            setConfirmed(chosenCard.id); setHasSession(false);
          }
        }}>
        {preview.status === "ready" ? "Keep this companion" : "Use selected companion"}
      </GButton>
      <GButton onClick={() => setShowAll(x => !x)}>{showAll ? "Close choices" : "Choose a different one"}</GButton>
      <GButton onClick={() => { dismissPassiveAtlas(); setHasSession(false); }}>Not now</GButton>
    </div>
    <div className="row gap8" style={{ alignItems: "center", color: "var(--text-50)", fontSize: 12, marginTop: 16 }}>
      <ShieldCheck size={14} aria-hidden="true" />
      <span>No journal writing, question content or raw click history was collected. No email subscription or account setting is activated by the companion choice.</span>
    </div>
  </GlassCard>;
}
