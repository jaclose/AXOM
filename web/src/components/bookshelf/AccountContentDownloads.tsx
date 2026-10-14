import { useState } from "react";
import { Download } from "lucide-react";
import { useStore } from "../../lib/store";
import { downloadAccountContent, type ContentSelection } from "../../lib/sync/contentDownloads";
import { GButton, GlassCard, PanelHeader } from "../ui/primitives";

export function AccountContentDownloads() {
  const state = useStore();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const deferred = state.deferredContent;
  if (!deferred?.sources.length) return null;
  const ids = new Set(deferred.questions.map(question => question.id));
  const sets = state.questionSets.filter(set => set.questionIds.some(id => ids.has(id)));
  const assigned = new Set(sets.flatMap(set => set.questionIds));
  const unfiled = deferred.questions.filter(question => !assigned.has(question.id));
  async function download(selection: ContentSelection) {
    setBusy(true); setMessage("Downloading your saved content…");
    try { await downloadAccountContent(selection); setMessage("Saved on this device and ready to study."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Download unavailable. Your account content is safe; retry when connected."); }
    finally { setBusy(false); }
  }
  return <GlassCard className="account-content-downloads" role="region" aria-label="Saved account content">
    <PanelHeader headingLevel={2} title="Saved in your account" sub="Your answers and notes are protected. Download a set to study it on this device." />
    <div className="row wrap gap-sm">
      {sets.map(set => <GButton key={set.id} disabled={busy} onClick={() => void download({ questionIds: set.questionIds, documentIds: set.sourceDocumentIds })}>
        <Download size={16} aria-hidden="true" /> {set.title} · {set.questionIds.filter(id => ids.has(id)).length} questions
      </GButton>)}
      {unfiled.length > 0 && <GButton disabled={busy} onClick={() => void download({ questionIds: unfiled.map(question => question.id), documentIds: unfiled.flatMap(question => question.sourceDocumentId ? [question.sourceDocumentId] : []) })}>Download {unfiled.length} unfiled questions</GButton>}
    </div>
    {deferred.documents.length > 0 && <details><summary>Saved source documents ({deferred.documents.length})</summary>
      {deferred.documents.map(document => <GButton key={document.id} disabled={busy} onClick={() => void download({ documentIds: [document.id] })}>{document.title || "Source document"}</GButton>)}
    </details>}
    {message && <p role="status">{message}</p>}
  </GlassCard>;
}
