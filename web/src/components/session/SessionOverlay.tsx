// ===========================================================================
// Live session surface (directive §2). The running clock, pause/resume and
// quick logging live in the focus dock (components/dock/FocusDock). This
// component owns the full-screen focus mode and the completion capture
// (confidence, status, takeaway, blocker, energy), and on mount restores the
// live session after reload/sleep. Clocks are recomputed every second from
// absolute timestamp segments — never a stored counter.
// ===========================================================================
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import {
  findLiveSession, formatElapsed, sessionElapsedMs,
  QUICK_LOG_LABEL, type SessionCapture, type SessionQuickLog,
} from "../../lib/sessions";
import { useSessionUi } from "../../lib/sessionUi";
import { GButton, GhostButton, Tag } from "../ui/primitives";
import { Modal, Field, TextAreaField } from "../ui/Modal";

const QUICK_LOGS = Object.keys(QUICK_LOG_LABEL) as SessionQuickLog[];

export function SessionOverlay() {
  const sessions = useStore((st) => st.sessions);
  const restoreLiveSessions = useStore((st) => st.restoreLiveSessions);
  const session = findLiveSession(sessions ?? []);
  const { focusMode, capturing, setFocusMode, closeCapture } = useSessionUi();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Restore once on mount: caps stale open segments after sleep/reload.
  useEffect(() => {
    restoreLiveSessions();
  }, [restoreLiveSessions]);

  const sessionId = session?.id;
  const sessionStatus = session?.status;
  useEffect(() => {
    if (!focusMode || sessionStatus !== "active") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [focusMode, sessionId, sessionStatus]);

  // Leaving the session (finished elsewhere, discarded) also leaves focus mode.
  useEffect(() => {
    if (!session && (focusMode || capturing)) {
      setFocusMode(false);
      closeCapture();
    }
  }, [session, focusMode, capturing, setFocusMode, closeCapture]);

  const elapsedMs = useMemo(
    () => (session ? sessionElapsedMs(session, new Date(nowMs)) : 0),
    [session, nowMs],
  );

  if (!session) return null;
  const s = useStore.getState();

  return (
    <>
      {focusMode && (
        <div className="focus-overlay">
          <div className="focus-center">
            <div className="focus-clock mono">{formatElapsed(elapsedMs)}</div>
            <div className="focus-task">{session.title}</div>
            {session.link.context && <div className="sub">{session.link.context}</div>}
            {session.reason && <div className="focus-reason">{session.reason}</div>}
            {(session.resources?.length ?? 0) > 0 && (
              <div className="row" style={{ justifyContent: "center", flexWrap: "wrap", gap: 6 }}>
                {session.resources!.map((r, i) => <Tag key={i} tone="neutral">{r}</Tag>)}
              </div>
            )}
          </div>
        </div>
      )}
      {capturing && (
        <SessionCaptureModal
          onCancel={closeCapture}
          onAbandon={() => { s.abandonSession(session.id); closeCapture(); setFocusMode(false); }}
          onSave={(capture) => {
            s.completeSession(session.id, capture);
            closeCapture();
            setFocusMode(false);
          }}
        />
      )}
    </>
  );
}

function SessionCaptureModal({
  onSave, onCancel, onAbandon,
}: {
  onSave: (capture: SessionCapture) => void;
  onCancel: () => void;
  onAbandon: () => void;
}) {
  const [outcome, setOutcome] = useState<SessionQuickLog>("completed");
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5 | undefined>();
  const [takeaway, setTakeaway] = useState("");
  const [blocker, setBlocker] = useState("");
  const [energy, setEnergy] = useState<"Low" | "Medium" | "High" | undefined>();

  return (
    <Modal
      title="Close this session"
      onClose={onCancel}
      footer={
        <>
          <GhostButton onClick={onAbandon}>Discard session</GhostButton>
          <GButton variant="primary" onClick={() => onSave({
            outcome,
            confidence,
            takeaway: takeaway.trim() || undefined,
            blocker: blocker.trim() || undefined,
            energyAfter: energy,
          })}>
            Save & finish
          </GButton>
        </>
      }
    >
      <div className="stack gap6">
        <span className="field-label">How did it go?</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {QUICK_LOGS.map((log) => (
            <button key={log} className={`filter-pill ${outcome === log ? "on" : ""}`} onClick={() => setOutcome(log)}>
              {QUICK_LOG_LABEL[log]}
            </button>
          ))}
        </div>
      </div>
      <div className="stack gap6">
        <span className="field-label">Confidence in this material now</span>
        <div className="row">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button key={n} className={`filter-pill ${confidence === n ? "on" : ""}`} onClick={() => setConfidence(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <Field label="Key takeaway (one line, optional)" value={takeaway} onChange={(e) => setTakeaway(e.target.value)} />
      <TextAreaField label="Error or blocker (optional)" rows={2} value={blocker} onChange={(e) => setBlocker(e.target.value)} />
      <div className="stack gap6">
        <span className="field-label">Energy now (optional)</span>
        <div className="row">
          {(["Low", "Medium", "High"] as const).map((v) => (
            <button key={v} className={`filter-pill ${energy === v ? "on" : ""}`} onClick={() => setEnergy(v)}>{v}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
