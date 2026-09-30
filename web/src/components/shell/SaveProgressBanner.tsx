// The "Save your progress" invitation (lib/saveProgress.ts has the rules).
// Slides down from the top once the student has saved real work and has no
// account; waits for any modal, tour, Promise or focus layer to clear.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { CloudUpload, X } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { ICON_SIZE } from "../../lib/iconSize";
import { afterCreate, afterNotNow, hasMeaningfulData, readSaveProgress, shouldOfferSaveProgress, writeSaveProgress, type SaveProgressLedger } from "../../lib/saveProgress";
import { shellBusy } from "../../lib/shellBusy";
import { useUserMedia } from "../../lib/soundscapes/userMedia";
import { useStore } from "../../lib/store";
import "../../styles/save-progress.css";

/** Let the save that triggered this land and the screen settle first. */
const SETTLE_MS = 2200;

export function SaveProgressBanner({ suspended, onCreateAccount }: { suspended: boolean; onCreateAccount: () => void }) {
  const phase = useAccount((state) => state.phase);
  const meaningful = useStore((state) => hasMeaningfulData({
    logs: state.logs, questions: state.questions, questionSets: state.questionSets, documents: state.documents,
    tracker: state.tracker, journal: state.journal, dayPlans: state.dayPlans, userSounds: 0,
  }));
  const userSounds = useUserMedia((state) => state.items.filter((item) => item.kind === "sound").length);
  const [ledger, setLedger] = useState<SaveProgressLedger>(readSaveProgress);
  const [visible, setVisible] = useState(false);
  const titleId = useId();
  const eligible = !suspended && shouldOfferSaveProgress({ phase, meaningful: meaningful || userSounds > 0, ledger });

  useEffect(() => {
    if (!eligible || visible) return;
    const timer = window.setInterval(() => { if (!shellBusy()) setVisible(true); }, SETTLE_MS);
    return () => window.clearInterval(timer);
  }, [eligible, visible]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") notNow(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function settle(next: SaveProgressLedger) {
    writeSaveProgress(next);
    setLedger(next);
    setVisible(false);
  }
  function notNow() { settle(afterNotNow(ledger)); }
  function create() {
    settle(afterCreate());
    onCreateAccount();
  }

  if (!visible || !eligible) return null;
  return createPortal(
    <section className="save-progress" aria-labelledby={titleId}>
      <span className="save-progress-icon" aria-hidden="true"><CloudUpload size={ICON_SIZE.emphasis} /></span>
      <div className="save-progress-copy">
        <b id={titleId}>Save your progress</b>
        <span>Make a free account so your AXOM follows you to any device.</span>
      </div>
      <div className="save-progress-actions">
        <button type="button" className="gbtn sm primary" onClick={create}>Make an account</button>
        <button type="button" className="gbtn sm" onClick={notNow}>Not now</button>
      </div>
      <button type="button" className="save-progress-close" aria-label="Not now" onClick={notNow}><X size={ICON_SIZE.body} aria-hidden="true" /></button>
    </section>,
    document.body,
  );
}
